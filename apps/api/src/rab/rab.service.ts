import { randomUUID } from 'node:crypto';
import {
  aggregateRabGroups,
  calculateRab,
  Decimal,
  rabTotals,
  type RabRowValues,
} from '@laporan-proyek/calc';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  latestInDomainOrder,
  mcNumberError,
  nextMcNumber,
  rabVersionLabel,
  type CreateRabItemInput,
  type CreateRabVersionInput,
  type RabChangeType,
  type RabCompareDto,
  type RabHistoryDto,
  type RabIssue,
  type RabRowDto,
  type RabSnapshotDto,
  type RabSnapshotPayload,
  type RabSnapshotSummaryDto,
  type RabTotalsDto,
  type ReorderRabItemsInput,
  type RabVersionDetailDto,
  type RabVersionSummaryDto,
  type UpdateRabItemInput,
  type UpdateRabVersionInput,
} from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import { AccessService } from '../auth/access.service';
import type { AuthUser } from '../auth/auth-context';
import { Prisma } from '../generated/prisma/client';
import { copyAnalysesIntoPackage, ensurePackage } from '../ahsp/package';
import { PrismaService } from '../prisma/prisma.service';
import { fromDbDate, toDbDate } from '../projects/project-calendar';
import { canonicalJson, changedFields, checksumOf, withCorrection } from './provenance';

type Db = Prisma.TransactionClient;

const USER_REF = { select: { id: true, name: true } } as const;
const VERSION_SELECT = {
  id: true,
  projectId: true,
  versionType: true,
  revisionNumber: true,
  documentNumber: true,
  documentDate: true,
  previousVersionId: true,
  status: true,
  totalBeforeTax: true,
  totalTax: true,
  totalValue: true,
  createdAt: true,
  approvedAt: true,
  discardedAt: true,
  discardReason: true,
  createdByUser: USER_REF,
  approvedByUser: USER_REF,
} as const satisfies Prisma.RabVersionSelect;
type VersionRow = Prisma.RabVersionGetPayload<{ select: typeof VERSION_SELECT }>;

const ITEM_SELECT = {
  id: true,
  parentItemId: true,
  sortOrder: true,
  rowType: true,
  workItemId: true,
  workItem: { select: { internalCode: true } },
  displayNumber: true,
  description: true,
  volume: true,
  unit: true,
  analysisCode: true,
  unitPrice: true,
  taxPercent: true,
  unitPriceWithTax: true,
  subtotal: true,
  analysisVersionId: true,
  priceSource: true,
  sourceUnitPrice: true,
  analysisUnitPrice: true,
  priceNote: true,
  priceDecidedBy: true,
  priceDecidedAt: true,
  sourceLocator: true,
  analysisVersion: {
    select: {
      analysisId: true,
      code: true,
      name: true,
      analysis: { select: { rabVersionId: true } },
    },
  },
} as const satisfies Prisma.RabVersionItemSelect;
type ItemRow = Prisma.RabVersionItemGetPayload<{ select: typeof ITEM_SELECT }>;

const ITEM_ONLY_FIELDS = ['volume', 'unit', 'analysisCode', 'unitPrice', 'taxPercent'] as const;
const NOT_EDITABLE = 'Versi RAB ini sudah tidak berstatus draft atau koreksi dan tidak dapat diubah.';
const OPEN_VERSION = 'Masih ada draft atau koreksi RAB; approve atau batalkan lebih dahulu.';
type EditableVersion = { status: 'DRAFT' | 'REOPENED'; documentNumber: string | null; documentDate: Date | null; previousVersionId: string | null };
/** Snapshot columns (D-043): integer digits each can hold; larger values would fail or truncate on approval. */
const LIMITS = { unitPriceWithTax: 20, subtotal: 30, total: 32 } as const;
const exceeds = (value: string | null, integerDigits: number) =>
  value !== null && new Decimal(value).abs().gte(new Decimal(10).pow(integerDigits));

/** Exact decimal string without trailing zeros or exponent (DB scale padding is not meaningful). */
const num = (value: Prisma.Decimal | null) =>
  value === null ? null : new Decimal(value.toString()).toFixed();

/** Depth-first order by sort_order, with depth (the grid and exports show the hierarchy). */
function treeOrder(items: ItemRow[]): (ItemRow & { depth: number })[] {
  const byParent = new Map<string | null, ItemRow[]>();
  for (const item of items)
    byParent.set(item.parentItemId, [...(byParent.get(item.parentItemId) ?? []), item]);
  const ordered: (ItemRow & { depth: number })[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const item of (byParent.get(parentId) ?? []).sort((a, b) => a.sortOrder - b.sortOrder)) {
      ordered.push({ ...item, depth });
      walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  return ordered;
}

/** APPROVED versions show their stored snapshot (D-042); drafts are computed now. */
function rowValues(
  status: string,
  items: ItemRow[],
): { values: Map<string, RabRowValues>; totals: RabTotalsDto } {
  const inputs = items.map((i) => ({
    id: i.id,
    parentId: i.parentItemId,
    rowType: i.rowType,
    volume: num(i.volume),
    unitPrice: num(i.unitPrice),
    taxPercent: num(i.taxPercent),
  }));
  if (status !== 'APPROVED') {
    const { rows, totals } = calculateRab(inputs);
    return { values: rows, totals };
  }
  const values = new Map<string, RabRowValues>();
  let beforeTax = new Decimal(0);
  let value = new Decimal(0);
  for (const i of items) {
    if (i.rowType !== 'ITEM') continue;
    const itemBeforeTax =
      i.volume && i.unitPrice
        ? new Decimal(i.volume.toString()).times(i.unitPrice.toString())
        : null;
    if (itemBeforeTax) beforeTax = beforeTax.plus(itemBeforeTax);
    if (i.subtotal) value = value.plus(i.subtotal.toString());
    values.set(i.id, {
      unitPriceWithTax: num(i.unitPriceWithTax),
      subtotalBeforeTax: itemBeforeTax?.toFixed() ?? null,
      subtotal: num(i.subtotal),
      weight: null,
    });
  }
  aggregateRabGroups(inputs, values, value.toFixed());
  return { values, totals: rabTotals(beforeTax, value) };
}

function toRows(items: ItemRow[], values: Map<string, RabRowValues>): RabRowDto[] {
  return treeOrder(items).map((i) => {
    const v = values.get(i.id);
    return {
      id: i.id,
      parentId: i.parentItemId,
      depth: i.depth,
      rowType: i.rowType,
      workItemId: i.workItemId,
      workItemCode: i.workItem?.internalCode ?? null,
      displayNumber: i.displayNumber,
      description: i.description,
      volume: num(i.volume),
      unit: i.unit,
      analysisCode: i.analysisCode,
      unitPrice: num(i.unitPrice),
      taxPercent: num(i.taxPercent),
      unitPriceWithTax: v?.unitPriceWithTax ?? null,
      subtotalBeforeTax: v?.subtotalBeforeTax ?? null,
      subtotal: v?.subtotal ?? null,
      weight: v?.weight ?? null,
      priceSource: i.priceSource,
      analysis:
        i.analysisVersionId && i.analysisVersion
          ? {
              analysisId: i.analysisVersion.analysisId,
              versionId: i.analysisVersionId,
              rabVersionId: i.analysisVersion.analysis.rabVersionId,
              code: i.analysisVersion.code,
              name: i.analysisVersion.name,
            }
          : null,
      priceNote: i.priceNote,
      sourceLocator: i.sourceLocator,
      sourceUnitPrice: num(i.sourceUnitPrice),
      analysisUnitPrice: num(i.analysisUnitPrice),
      priceDecidedAt: i.priceDecidedAt?.toISOString() ?? null,
    };
  });
}

function toSummary(v: VersionRow, totals: RabTotalsDto, itemCount: number): RabVersionSummaryDto {
  return {
    id: v.id,
    versionType: v.versionType,
    revisionNumber: v.revisionNumber,
    label: rabVersionLabel(v),
    status: v.status,
    documentNumber: v.documentNumber,
    documentDate: v.documentDate ? fromDbDate(v.documentDate) : null,
    previousVersionId: v.previousVersionId,
    totals:
      v.status === 'APPROVED'
        ? rabTotals(v.totalBeforeTax!.toString(), v.totalValue!.toString())
        : totals,
    itemCount,
    createdBy: v.createdByUser,
    createdAt: v.createdAt.toISOString(),
    approvedBy: v.approvedByUser,
    approvedAt: v.approvedAt?.toISOString() ?? null,
    discardedAt: v.discardedAt?.toISOString() ?? null,
    discardReason: v.discardReason,
  };
}

/** Blocking errors and warnings that must be acknowledged before approval (D-040). */
function validate(
  rows: RabRowDto[],
  totals: RabTotalsDto,
  contractValue: string | null,
  versionType: string,
  versionId: string,
): { errors: RabIssue[]; warnings: RabIssue[] } {
  const errors: RabIssue[] = [];
  const warnings: RabIssue[] = [];
  const items = rows.filter((r) => r.rowType === 'ITEM');
  if (items.length === 0) errors.push({ message: 'RAB belum memiliki baris pekerjaan (ITEM).' });
  for (const r of items) {
    const missing = [
      !r.unit && 'satuan',
      r.volume === null && 'volume',
      r.unitPrice === null && 'harga satuan',
      r.taxPercent === null && 'PPN',
    ].filter(Boolean);
    if (missing.length)
      errors.push({
        itemId: r.id,
        message:
          `${r.displayNumber ?? ''} ${r.description}: ${missing.join(', ')} belum diisi.`.trim(),
      });
    else if (r.volume !== null && new Decimal(r.volume).isZero())
      warnings.push({
        itemId: r.id,
        message: `${r.displayNumber ?? ''} ${r.description}: volume 0.`.trim(),
      });
  }
  // Valid inputs can still overflow DECIMAL(20,2) after tax or multiplication; block before the snapshot is stored.
  for (const r of items) {
    const label = `${r.displayNumber ?? ''} ${r.description}`.trim();
    if (exceeds(r.unitPriceWithTax, LIMITS.unitPriceWithTax))
      errors.push({
        itemId: r.id,
        message: `${label}: harga + PPN melebihi batas nilai yang dapat disimpan (maks. 20 digit rupiah).`,
      });
    else if (exceeds(r.subtotal, LIMITS.subtotal))
      errors.push({
        itemId: r.id,
        message: `${label}: jumlah (volume × harga + PPN) melebihi batas nilai yang dapat disimpan.`,
      });
  }
  // D-056/D-057: a version only links analyses of its own package.
  for (const r of items) {
    if (r.analysis && r.analysis.rabVersionId !== versionId)
      errors.push({
        itemId: r.id,
        message:
          `${r.displayNumber ?? ''} ${r.description}: analisa ${r.analysis.code ?? r.analysis.name} milik paket versi RAB lain.`.trim(),
      });
  }
  if (exceeds(totals.value, LIMITS.total) || exceeds(totals.beforeTax, LIMITS.total))
    errors.push({
      message: 'Total RAB melebihi batas nilai yang dapat disimpan (maks. 32 digit rupiah).',
    });
  const hasChild = new Set(rows.map((r) => r.parentId));
  for (const r of rows)
    if (r.rowType !== 'ITEM' && !hasChild.has(r.id))
      warnings.push({
        itemId: r.id,
        message: `${r.displayNumber ?? ''} ${r.description}: tidak memiliki sub-baris.`.trim(),
      });
  // The contract may state the REAL COST or the DIBULATKAN figure (D-043).
  if (
    versionType === 'CONTRACT' &&
    contractValue !== null &&
    !new Decimal(contractValue).equals(totals.realCost) &&
    !new Decimal(contractValue).equals(totals.rounded)
  ) {
    warnings.push({
      message: `Total RAB Kontrak (${totals.realCost}; dibulatkan ${totals.rounded}) berbeda dengan nilai kontrak proyek (${contractValue}).`,
    });
  }
  return { errors, warnings };
}

const SNAPSHOT_SUMMARY = {
  id: true,
  sequence: true,
  approvedAt: true,
  approvedByUser: USER_REF,
  totalValue: true,
  checksum: true,
  createdAt: true,
  createdByUser: USER_REF,
} as const satisfies Prisma.RabVersionSnapshotSelect;

const toSnapshotSummary = (
  s: Prisma.RabVersionSnapshotGetPayload<{ select: typeof SNAPSHOT_SUMMARY }>,
): RabSnapshotSummaryDto => ({
  id: s.id,
  sequence: s.sequence,
  approvedAt: s.approvedAt?.toISOString() ?? null,
  approvedBy: s.approvedByUser,
  totalValue: num(s.totalValue),
  checksum: s.checksum,
  createdAt: s.createdAt.toISOString(),
  createdBy: s.createdByUser,
});

const sameDecimal = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : new Decimal(a).equals(b);

@Injectable()
export class RabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(projectId: string): Promise<RabVersionSummaryDto[]> {
    const versions = await this.prisma.rabVersion.findMany({
      where: { projectId },
      select: VERSION_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      versions.map(async (v) => {
        const items = await this.prisma.rabVersionItem.findMany({
          where: { rabVersionId: v.id },
          select: ITEM_SELECT,
        });
        const { totals } = rowValues(v.status, items);
        return toSummary(v, totals, items.filter((i) => i.rowType === 'ITEM').length);
      }),
    );
  }

  async get(projectId: string, versionId: string): Promise<RabVersionDetailDto> {
    return this.detail(this.prisma, projectId, versionId);
  }

  /** CONTRACT starts empty; each MC copies the latest approved version (D-040, D-069). One DRAFT per project. */
  async create(
    actor: AuthUser,
    projectId: string,
    input: CreateRabVersionInput,
  ): Promise<RabVersionDetailDto> {
    const versionId = await this.prisma.$transaction(
      async (tx) =>
        (await this.createVersionInTx(tx, actor, projectId, input, { copyPrevious: true })).id,
    );
    return this.get(projectId, versionId);
  }

  /**
   * Creates a version under the order rules (one DRAFT per project, CONTRACT → MC-0 … MC-100, D-069) inside
   * the caller's transaction. Manual creation copies the previous approved version; an approved import
   * fills the rows itself (D-049, D-053) — the only other caller, so there is a single RAB creation path.
   */
  async createVersionInTx(
    tx: Db,
    actor: AuthUser,
    projectId: string,
    input: CreateRabVersionInput,
    options: { copyPrevious: boolean },
  ): Promise<{
    id: string;
    previousVersionId: string | null;
    versionType: string;
    revisionNumber: number;
  }> {
    await this.lockActiveProject(tx, projectId);
    const versions = await tx.rabVersion.findMany({
      where: { projectId, status: { not: 'DISCARDED' } },
      select: { id: true, versionType: true, revisionNumber: true, status: true, approvedAt: true },
    });
    if (versions.some((v) => v.status === 'DRAFT' || v.status === 'REOPENED'))
      throw new ConflictException(OPEN_VERSION);
    // Domain order, not approval time: re-approving a corrected Kontrak must not make it "latest" (D-068).
    const latest = latestInDomainOrder(versions.filter((v) => v.status === 'APPROVED'));

    let revisionNumber = 0;
    if (input.versionType === 'CONTRACT') {
      if (versions.length > 0) throw new ConflictException('RAB Kontrak sudah ada.');
    } else if (!latest) {
      throw new ConflictException('RAB Kontrak harus di-approve sebelum membuat MC.');
    } else {
      revisionNumber = input.revisionNumber ?? nextMcNumber(versions);
      const invalid = mcNumberError(versions, revisionNumber);
      if (invalid) throw new ConflictException(invalid);
    }

    const version = await tx.rabVersion.create({
      data: {
        projectId,
        versionType: input.versionType,
        revisionNumber,
        documentNumber: input.documentNumber ?? null,
        documentDate: input.documentDate ? toDbDate(input.documentDate) : null,
        previousVersionId: input.versionType === 'CONTRACT' ? null : latest!.id,
        createdBy: actor.id,
      },
    });
    if (input.versionType !== 'CONTRACT' && options.copyPrevious)
      await this.copyItems(tx, actor, projectId, latest!.id, version.id);
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'CREATE_RAB_VERSION',
      entityType: 'RAB_VERSION',
      entityId: version.id,
      projectId,
      newValue: {
        versionType: input.versionType,
        revisionNumber,
        previousVersionId: version.previousVersionId,
        documentNumber: version.documentNumber,
        documentDate: input.documentDate ?? null,
      },
    });
    return {
      id: version.id,
      previousVersionId: version.previousVersionId,
      versionType: version.versionType,
      revisionNumber,
    };
  }

  async updateVersion(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    input: UpdateRabVersionInput,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.lockEditable(tx, actor, projectId, versionId, input.reason);
      const current = {
        documentNumber: version.documentNumber,
        documentDate: version.documentDate ? fromDbDate(version.documentDate) : null,
      };
      const next = {
        documentNumber:
          input.documentNumber === undefined ? current.documentNumber : input.documentNumber,
        documentDate: input.documentDate === undefined ? current.documentDate : input.documentDate,
      };
      if (
        next.documentNumber === current.documentNumber &&
        next.documentDate === current.documentDate
      )
        return;
      await tx.rabVersion.update({
        where: { id: versionId },
        data: {
          documentNumber: next.documentNumber,
          documentDate: next.documentDate ? toDbDate(next.documentDate) : null,
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'UPDATE_RAB_VERSION',
        entityType: 'RAB_VERSION',
        entityId: versionId,
        projectId,
        oldValue: current,
        newValue: next,
        reason: input.reason,
      });
    });
    return this.get(projectId, versionId);
  }

  async addItem(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    input: CreateRabItemInput,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.lockEditable(tx, actor, projectId, versionId, input.reason);
      const parentId = input.parentId ?? null;
      await this.assertValidParent(tx, versionId, input.rowType, parentId);
      const { rowType, reason, ...fields } = input;
      if (rowType !== 'ITEM' && ITEM_ONLY_FIELDS.some((f) => fields[f] != null)) {
        throw new BadRequestException(
          'Hanya baris ITEM yang memiliki volume, satuan, no analisa, harga, dan PPN.',
        );
      }
      const workItemId =
        rowType === 'ITEM' ? await this.newWorkItem(tx, projectId, input.description) : null;
      const values = {
        displayNumber: fields.displayNumber ?? null,
        description: fields.description,
        volume: fields.volume ?? null,
        unit: fields.unit ?? null,
        analysisCode: fields.analysisCode ?? null,
        unitPrice: fields.unitPrice ?? null,
        taxPercent: fields.taxPercent ?? null,
      };
      const correcting = version.status === 'REOPENED';
      const created = await tx.rabVersionItem.create({
        data: {
          ...values,
          rabVersionId: versionId,
          parentItemId: parentId,
          rowType,
          workItemId,
          sortOrder: await this.nextSortOrder(tx, versionId, parentId),
          // A row added during a correction is not from the source document.
          ...(correcting
            ? { sourceLocator: withCorrection(null, this.mark(actor, reason, changedFields({}, values))) }
            : {}),
        },
      });
      if (correcting)
        await this.correctionAudit(tx, actor, projectId, versionId, reason, {
          action: 'CORRECT_RAB_ITEM',
          oldValue: { itemId: created.id, operation: 'ADD' },
          newValue: { itemId: created.id, rowType, parentId, ...values },
        });
    });
    return this.get(projectId, versionId);
  }

  async updateItem(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    itemId: string,
    input: UpdateRabItemInput,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.lockEditable(tx, actor, projectId, versionId, input.reason);
      const item = await this.findItem(tx, versionId, itemId);
      const { parentId, reason, ...fields } = input;
      // D-051/D-068: the price of an analysis-linked item comes from its analysis; correct the analysis source.
      if (item.analysisVersionId && fields.unitPrice !== undefined) {
        throw new ConflictException(
          'Harga satuan item ini mengikuti analisa; koreksi harga dasar/koefisien/overhead pada analisa, bukan langsung di RAB.',
        );
      }
      if (item.rowType !== 'ITEM' && ITEM_ONLY_FIELDS.some((f) => fields[f] != null)) {
        throw new BadRequestException(
          'Hanya baris ITEM yang memiliki volume, satuan, no analisa, harga, dan PPN.',
        );
      }
      const data: Prisma.RabVersionItemUncheckedUpdateInput = { ...fields };
      const before: Record<string, string | number | null> = {
        displayNumber: item.displayNumber,
        description: item.description,
        volume: num(item.volume),
        unit: item.unit,
        analysisCode: item.analysisCode,
        unitPrice: num(item.unitPrice),
        taxPercent: num(item.taxPercent),
        parentId: item.parentItemId,
      };
      const after: Record<string, string | number | null | undefined> = { ...fields };
      if (parentId !== undefined && parentId !== item.parentItemId) {
        await this.assertValidParent(tx, versionId, item.rowType, parentId, itemId);
        data.parentItemId = parentId;
        data.sortOrder = await this.nextSortOrder(tx, versionId, parentId);
        after.parentId = parentId;
      }
      const changes = changedFields(before, after);
      if (version.status === 'REOPENED' && Object.keys(changes).length) {
        data.sourceLocator = withCorrection(item.sourceLocator, this.mark(actor, reason, changes));
        await this.correctionAudit(tx, actor, projectId, versionId, reason, {
          action: 'CORRECT_RAB_ITEM',
          oldValue: { itemId, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])) },
          newValue: { itemId, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])) },
        });
      }
      await tx.rabVersionItem.update({ where: { id: itemId }, data });
    });
    return this.get(projectId, versionId);
  }

  async deleteItem(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    itemId: string,
    reason?: string,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.lockEditable(tx, actor, projectId, versionId, reason);
      const item = await this.findItem(tx, versionId, itemId);
      if (version.status === 'REOPENED' && (await this.wasApproved(tx, versionId, item.createdAt)))
        throw new ConflictException(
          'Baris yang sudah pernah approved tidak dihapus saat koreksi; ubah isinya (misalnya volume) dengan alasan.',
        );
      if (await tx.rabVersionItem.count({ where: { parentItemId: itemId } }))
        throw new ConflictException('Hapus atau pindahkan sub-baris lebih dahulu.');
      await tx.rabVersionItem.delete({ where: { id: itemId } });
      // A work item created in this draft and used nowhere else goes too; copied ones stay (history).
      if (item.workItemId)
        await tx.workItem.deleteMany({
          where: { id: item.workItemId, versionItems: { none: {} } },
        });
      if (version.status === 'REOPENED')
        await this.correctionAudit(tx, actor, projectId, versionId, reason, {
          action: 'CORRECT_RAB_ITEM',
          oldValue: { itemId, operation: 'DELETE', description: item.description },
          newValue: { itemId, deleted: true },
        });
    });
    return this.get(projectId, versionId);
  }

  async moveItem(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    itemId: string,
    direction: 'up' | 'down',
    reason?: string,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.lockEditable(tx, actor, projectId, versionId, reason);
      const item = await this.findItem(tx, versionId, itemId);
      const sibling = await tx.rabVersionItem.findFirst({
        where: {
          rabVersionId: versionId,
          parentItemId: item.parentItemId,
          sortOrder: direction === 'up' ? { lt: item.sortOrder } : { gt: item.sortOrder },
        },
        orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
        select: { id: true, sortOrder: true },
      });
      if (!sibling) return;
      await tx.rabVersionItem.update({
        where: { id: item.id },
        data: { sortOrder: sibling.sortOrder },
      });
      await tx.rabVersionItem.update({
        where: { id: sibling.id },
        data: { sortOrder: item.sortOrder },
      });
      if (version.status === 'REOPENED')
        await this.correctionAudit(tx, actor, projectId, versionId, reason, {
          action: 'CORRECT_RAB_ITEM',
          oldValue: { itemId, sortOrder: item.sortOrder },
          newValue: { itemId, sortOrder: sibling.sortOrder, direction },
        });
    });
    return this.get(projectId, versionId);
  }

  /** Applies a drag reorder to the complete sibling set in one transaction. */
  async reorderItems(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    input: ReorderRabItemsInput,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      // Order changes no value, so a reopened version takes it without a reason (still rab.reopen + audited).
      const version = await this.lockEditable(tx, actor, projectId, versionId, input.reason, false);
      const siblings = await tx.rabVersionItem.findMany({
        where: { rabVersionId: versionId, parentItemId: input.parentId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, sortOrder: true, sourceLocator: true },
      });
      const requested = new Set(input.itemIds);
      if (requested.size !== siblings.length || siblings.some((item) => !requested.has(item.id)))
        throw new BadRequestException('Urutan harus berisi semua baris saudara pada tingkat yang sama.');

      const previousOrder = siblings.map((item) => item.id);
      if (previousOrder.every((id, index) => id === input.itemIds[index])) return;

      // Keep the existing sort slots and only change which sibling occupies each slot.
      const sortOrders = siblings.map((item) => item.sortOrder);
      for (const [index, id] of input.itemIds.entries()) {
        const current = siblings.find((item) => item.id === id)!;
        const nextOrder = sortOrders[index]!;
        if (current.sortOrder !== nextOrder) {
          await tx.rabVersionItem.update({ where: { id }, data: { sortOrder: nextOrder } });
        }
      }
      if (version.status === 'REOPENED')
        await this.correctionAudit(tx, actor, projectId, versionId, input.reason, {
          action: 'CORRECT_RAB_ITEM',
          oldValue: { parentId: input.parentId, itemIds: previousOrder },
          newValue: { parentId: input.parentId, itemIds: input.itemIds, operation: 'REORDER' },
        });
    });
    return this.get(projectId, versionId);
  }

  /**
   * D-068: APPROVED -> REOPENED on the same version. The approved state is archived first when it has no
   * snapshot yet (versions approved before D-068), so the archive always holds what was approved.
   */
  async reopen(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    reason: string,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockActiveProject(tx, projectId);
      const versions = await tx.rabVersion.findMany({
        where: { projectId },
        select: { id: true, status: true },
      });
      const version = versions.find((v) => v.id === versionId);
      if (!version) throw new NotFoundException('Versi RAB tidak ditemukan.');
      if (version.status !== 'APPROVED')
        throw new ConflictException('Hanya versi RAB approved yang dapat dibuka kembali.');
      if (versions.some((v) => v.status === 'DRAFT' || v.status === 'REOPENED'))
        throw new ConflictException(OPEN_VERSION);
      let snapshot = await tx.rabVersionSnapshot.findFirst({
        where: { rabVersionId: versionId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true, checksum: true },
      });
      snapshot ??= await this.archive(tx, actor, projectId, versionId);
      await tx.rabVersion.update({ where: { id: versionId }, data: { status: 'REOPENED' } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'REOPEN_RAB_VERSION',
        entityType: 'RAB_VERSION',
        entityId: versionId,
        projectId,
        oldValue: { status: 'APPROVED', snapshotSequence: snapshot.sequence, checksum: snapshot.checksum },
        newValue: { status: 'REOPENED' },
        reason,
      });
    });
    return this.get(projectId, versionId);
  }

  async history(projectId: string, versionId: string): Promise<RabHistoryDto> {
    await this.findVersion(projectId, versionId);
    const [snapshots, events] = await Promise.all([
      this.prisma.rabVersionSnapshot.findMany({
        where: { rabVersionId: versionId },
        select: SNAPSHOT_SUMMARY,
        orderBy: { sequence: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        where: { projectId, entityType: 'RAB_VERSION', entityId: versionId },
        select: { id: true, action: true, actor: USER_REF, createdAt: true, reason: true, oldValue: true, newValue: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      snapshots: snapshots.map(toSnapshotSummary),
      events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    };
  }

  /** Stored payload as archived; never recomputed from live rows (D-068). */
  async snapshot(projectId: string, versionId: string, snapshotId: string): Promise<RabSnapshotDto> {
    await this.findVersion(projectId, versionId);
    const s = await this.prisma.rabVersionSnapshot.findFirst({
      where: { id: snapshotId, rabVersionId: versionId },
      select: { ...SNAPSHOT_SUMMARY, payload: true },
    });
    if (!s) throw new NotFoundException('Snapshot RAB tidak ditemukan.');
    return {
      ...toSnapshotSummary(s),
      checksumValid: checksumOf(s.payload) === s.checksum,
      payload: s.payload as unknown as RabSnapshotPayload,
    };
  }

  /**
   * Validates, stores per-row and total snapshots, and locks the version (D-040, D-042). A REOPENED version is
   * approved again the same way; every approval also appends a full archive snapshot (D-068).
   */
  async approve(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    acknowledgeWarnings: boolean,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { status } = await this.lockVersion(tx, projectId, versionId);
      const { rows, totals, issues } = await this.detail(tx, projectId, versionId);
      if (issues.errors.length)
        throw new ConflictException({
          message: 'RAB belum dapat di-approve.',
          errors: issues.errors,
          warnings: issues.warnings,
        });
      if (issues.warnings.length && !acknowledgeWarnings) {
        throw new ConflictException({
          message: 'Konfirmasi peringatan sebelum approve.',
          errors: [],
          warnings: issues.warnings,
        });
      }
      for (const row of rows.filter((r) => r.rowType === 'ITEM')) {
        await tx.rabVersionItem.update({
          where: { id: row.id },
          data: { unitPriceWithTax: row.unitPriceWithTax, subtotal: row.subtotal },
        });
      }
      const approvedAt = new Date();
      await tx.rabVersion.update({
        where: { id: versionId },
        data: {
          status: 'APPROVED',
          totalBeforeTax: totals.beforeTax,
          totalTax: totals.tax,
          totalValue: totals.value,
          approvedBy: actor.id,
          approvedAt,
        },
      });
      const snapshot = await this.archive(tx, actor, projectId, versionId);
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'APPROVE_RAB_VERSION',
        entityType: 'RAB_VERSION',
        entityId: versionId,
        projectId,
        oldValue: { status },
        newValue: {
          status: 'APPROVED',
          ...totals,
          itemCount: rows.filter((r) => r.rowType === 'ITEM').length,
          acknowledgedWarnings: issues.warnings.map((w) => w.message),
          snapshotSequence: snapshot.sequence,
          checksum: snapshot.checksum,
        },
      });
    });
    return this.get(projectId, versionId);
  }

  async discard(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    reason: string,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { status } = await this.lockVersion(tx, projectId, versionId);
      // An approved baseline under correction is history, not a draft to throw away (D-068).
      if (status === 'REOPENED')
        throw new ConflictException(
          'Versi yang sedang dikoreksi sudah pernah approved dan tidak dapat dibatalkan; selesaikan koreksi lalu approve ulang.',
        );
      await tx.rabVersion.update({
        where: { id: versionId },
        data: {
          status: 'DISCARDED',
          discardedBy: actor.id,
          discardedAt: new Date(),
          discardReason: reason,
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'DISCARD_RAB_VERSION',
        entityType: 'RAB_VERSION',
        entityId: versionId,
        projectId,
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'DISCARDED' },
        reason,
      });
    });
    return this.get(projectId, versionId);
  }

  /**
   * ITEM rows matched by permanent work item (PRD §9-10). A row also counts as MODIFIED when it moved to
   * another group: groups are identified by their copy lineage (previous_version_item_id back to the row
   * they were first created as), so the new ids a copy gets are not a change by themselves.
   */
  async compare(projectId: string, baseId: string, targetId: string): Promise<RabCompareDto> {
    const [base, target] = await Promise.all([
      this.get(projectId, baseId),
      this.get(projectId, targetId),
    ]);
    const groups = await this.prisma.rabVersionItem.findMany({
      where: { rabVersion: { projectId }, rowType: { not: 'ITEM' } },
      select: { id: true, previousVersionItemId: true },
    });
    const previous = new Map(groups.map((g) => [g.id, g.previousVersionItemId]));
    const origin = (id: string): string => {
      const seen = new Set<string>();
      let current = id;
      for (let p = previous.get(current); p && !seen.has(p); p = previous.get(current)) {
        seen.add(current);
        current = p;
      }
      return current;
    };
    const lineage = (rows: RabRowDto[]) => {
      const byId = new Map(rows.map((r) => [r.id, r]));
      return (row: RabRowDto) => {
        const ancestors: RabRowDto[] = [];
        for (
          let p = row.parentId ? byId.get(row.parentId) : undefined;
          p;
          p = p.parentId ? byId.get(p.parentId) : undefined
        )
          ancestors.unshift(p);
        return {
          key: ancestors.map((a) => origin(a.id)).join('>'),
          label: ancestors.map((a) => a.displayNumber || a.description).join(' › '),
        };
      };
    };
    const baseLineage = lineage(base.rows);
    const targetLineage = lineage(target.rows);

    const baseItems = new Map(
      base.rows.filter((r) => r.rowType === 'ITEM').map((r) => [r.workItemId!, r]),
    );
    const targetItems = target.rows.filter((r) => r.rowType === 'ITEM');
    const rows: RabCompareDto['rows'] = targetItems.map((t) => {
      const b = baseItems.get(t.workItemId!) ?? null;
      const tg = targetLineage(t);
      if (!b)
        return {
          workItemId: t.workItemId!,
          workItemCode: t.workItemCode!,
          change: 'NEW',
          changes: [],
          baseGroup: null,
          targetGroup: tg.label,
          base: null,
          target: t,
        };
      const bg = baseLineage(b);
      const changes: RabCompareDto['rows'][number]['changes'] = [];
      if (b.description !== t.description) changes.push('description');
      if (b.unit !== t.unit) changes.push('unit');
      if (b.analysisCode !== t.analysisCode) changes.push('analysisCode');
      if (!sameDecimal(b.volume, t.volume)) changes.push('volume');
      if (!sameDecimal(b.unitPrice, t.unitPrice)) changes.push('unitPrice');
      if (!sameDecimal(b.taxPercent, t.taxPercent)) changes.push('taxPercent');
      if (bg.key !== tg.key) changes.push('group');
      const change: RabChangeType = changes.length ? 'MODIFIED' : 'UNCHANGED';
      return {
        workItemId: t.workItemId!,
        workItemCode: t.workItemCode!,
        change,
        changes,
        baseGroup: bg.label,
        targetGroup: tg.label,
        base: b,
        target: t,
      };
    });
    const inTarget = new Set(targetItems.map((t) => t.workItemId));
    for (const b of baseItems.values()) {
      if (!inTarget.has(b.workItemId)) {
        rows.push({
          workItemId: b.workItemId!,
          workItemCode: b.workItemCode!,
          change: 'REMOVED',
          changes: [],
          baseGroup: baseLineage(b).label,
          targetGroup: null,
          base: b,
          target: null,
        });
      }
    }
    return { base: base.version, target: target.version, rows };
  }

  private async detail(db: Db, projectId: string, versionId: string): Promise<RabVersionDetailDto> {
    const version = await db.rabVersion.findFirst({
      where: { id: versionId, projectId },
      select: VERSION_SELECT,
    });
    if (!version) throw new NotFoundException('Versi RAB tidak ditemukan.');
    const items = await db.rabVersionItem.findMany({
      where: { rabVersionId: versionId },
      select: ITEM_SELECT,
    });
    const { values, totals: computed } = rowValues(version.status, items);
    const rows = toRows(items, values);
    const summary = toSummary(version, computed, rows.filter((r) => r.rowType === 'ITEM').length);
    let issues: RabVersionDetailDto['issues'] = { errors: [], warnings: [] };
    if (version.status === 'DRAFT' || version.status === 'REOPENED') {
      const project = await db.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { contractValue: true },
      });
      issues = validate(
        rows,
        summary.totals,
        project.contractValue?.toFixed(2) ?? null,
        version.versionType,
        versionId,
      );
    }
    return { version: summary, rows, totals: summary.totals, issues };
  }

  /**
   * Copies rows in tree order so parents exist before children; ids are generated here for createMany.
   * Linked analyses are copied into the new version's package with their sub-analyses and prices (D-057).
   */
  private async copyItems(
    tx: Db,
    actor: AuthUser,
    projectId: string,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<void> {
    const source = treeOrder(
      await tx.rabVersionItem.findMany({
        where: { rabVersionId: fromVersionId },
        select: ITEM_SELECT,
      }),
    );
    const newIds = new Map(source.map((i) => [i.id, randomUUID()]));
    const linked = new Set(
      source.flatMap((i) => (i.analysisVersionId ? [i.analysisVersionId] : [])),
    );
    let copied = new Map<string, string>();
    if (linked.size) {
      const from = await tx.priceList.findUnique({
        where: { rabVersionId: fromVersionId },
        select: { location: true, period: true },
      });
      const priceListId = await ensurePackage(
        tx,
        projectId,
        toVersionId,
        actor.id,
        from ?? { location: null, period: null },
      );
      copied = await copyAnalysesIntoPackage(
        tx,
        { projectId, rabVersionId: toVersionId, priceListId, sourceImportId: null },
        linked,
      );
    }
    await tx.rabVersionItem.createMany({
      data: source.map((i) => ({
        id: newIds.get(i.id)!,
        rabVersionId: toVersionId,
        workItemId: i.workItemId,
        parentItemId: i.parentItemId ? newIds.get(i.parentItemId)! : null,
        sortOrder: i.sortOrder,
        rowType: i.rowType,
        displayNumber: i.displayNumber,
        description: i.description,
        volume: i.volume,
        unit: i.unit,
        analysisCode: i.analysisCode,
        unitPrice: i.unitPrice,
        taxPercent: i.taxPercent,
        previousVersionItemId: i.id,
        // The copy links the same analysis inside its own package and keeps how its price was decided.
        analysisVersionId: i.analysisVersionId ? copied.get(i.analysisVersionId)! : null,
        priceSource: i.priceSource,
        sourceUnitPrice: i.sourceUnitPrice,
        analysisUnitPrice: i.analysisUnitPrice,
        priceNote: i.priceNote,
        priceDecidedBy: i.priceDecidedBy,
        priceDecidedAt: i.priceDecidedAt,
        sourceLocator: (i.sourceLocator ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
  }

  /** Project row lock first, then the version, so every RAB write on a project serializes. */
  private async lockActiveProject(tx: Db, projectId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    if (project.status === 'CLOSED')
      throw new ConflictException('Proyek sudah ditutup; RAB tidak dapat diubah.');
  }

  /** Project lock first, then the version: the same order for every RAB/package write (D-068). */
  private async lockVersion(
    tx: Db,
    projectId: string,
    versionId: string,
  ): Promise<EditableVersion> {
    // The project row lock serializes every RAB write of the project, so the version needs no own lock.
    await this.lockActiveProject(tx, projectId);
    const version = await tx.rabVersion.findFirst({
      where: { id: versionId, projectId },
      select: { status: true, documentNumber: true, documentDate: true, previousVersionId: true },
    });
    if (!version) throw new NotFoundException('Versi RAB tidak ditemukan.');
    if (version.status !== 'DRAFT' && version.status !== 'REOPENED') throw new ConflictException(NOT_EDITABLE);
    return { ...version, status: version.status };
  }

  /**
   * Locks a DRAFT or REOPENED version for a change. A REOPENED version also needs the correction right
   * (`rab.reopen`) and, for value changes, a reason: `rab.edit` alone never reaches an approved baseline (D-068).
   */
  async lockEditable(
    tx: Db,
    actor: AuthUser,
    projectId: string,
    versionId: string,
    reason: string | undefined,
    reasonRequired = true,
  ): Promise<EditableVersion> {
    const version = await this.lockVersion(tx, projectId, versionId);
    if (version.status === 'REOPENED') {
      if (!(await this.access.hasProjectPermission(actor, projectId, 'rab.reopen')))
        throw new ForbiddenException('Mengubah RAB yang sedang dikoreksi memerlukan izin koreksi RAB (rab.reopen).');
      if (reasonRequired && !reason?.trim()) throw new BadRequestException('Alasan koreksi wajib diisi.');
    }
    return version;
  }

  mark(actor: AuthUser, reason: string | undefined, changes: Record<string, [string | number | null, string | number | null]>, kind: 'MANUAL' | 'RECALCULATED' = 'MANUAL') {
    return { at: new Date().toISOString(), by: actor.name, reason: reason?.trim() || null, kind, changes };
  }

  /** Every correction is recorded on the RAB version, so its history is one audit query. */
  correctionAudit(
    tx: Db,
    actor: AuthUser,
    projectId: string,
    versionId: string,
    reason: string | undefined,
    entry: { action: 'CORRECT_RAB_ITEM' | 'CORRECT_RAB_WORK_ITEM' | 'CORRECT_PRICE_ITEM' | 'CORRECT_AHSP_COMPONENT' | 'CORRECT_AHSP_ANALYSIS'; oldValue: Prisma.InputJsonObject; newValue: Prisma.InputJsonObject },
  ) {
    return writeAudit(tx, { actorId: actor.id, entityType: 'RAB_VERSION', entityId: versionId, projectId, reason, ...entry });
  }

  /** Rows present at the last approval are history; rows added during the correction are not. */
  private async wasApproved(tx: Db, versionId: string, createdAt: Date): Promise<boolean> {
    const last = await tx.rabVersionSnapshot.findFirst({
      where: { rabVersionId: versionId },
      orderBy: { sequence: 'desc' },
      select: { createdAt: true },
    });
    return !last || createdAt <= last.createdAt;
  }

  /**
   * Appends the version's current approved state to the archive: identity, every row with its snapshot values,
   * work items and copy relations, and the package (prices, analyses, components) with provenance (D-068).
   */
  private async archive(tx: Db, actor: AuthUser, projectId: string, versionId: string) {
    const stored = await this.snapshotPayload(tx, projectId, versionId);
    const last = await tx.rabVersionSnapshot.aggregate({
      where: { rabVersionId: versionId },
      _max: { sequence: true },
    });
    return tx.rabVersionSnapshot.create({
      data: {
        rabVersionId: versionId,
        sequence: (last._max.sequence ?? 0) + 1,
        approvedBy: stored.version.approvedBy,
        approvedAt: stored.version.approvedAt ? new Date(stored.version.approvedAt) : null,
        totalValue: stored.totals.value,
        payload: stored as unknown as Prisma.InputJsonObject,
        checksum: checksumOf(stored),
        createdBy: actor.id,
      },
      select: { sequence: true, checksum: true },
    });
  }

  /** The current state of a version as stored in a snapshot: parsed canonical JSON, so checksums compare. */
  private async snapshotPayload(tx: Db, projectId: string, versionId: string): Promise<RabSnapshotPayload> {
    const { version, rows, totals } = await this.detail(tx, projectId, versionId);
    const v = await tx.rabVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: { projectId: true, approvedBy: true, approvedAt: true },
    });
    const copies = new Map(
      (
        await tx.rabVersionItem.findMany({
          where: { rabVersionId: versionId },
          select: { id: true, previousVersionItemId: true },
        })
      ).map((i) => [i.id, i.previousVersionItemId]),
    );
    const priceList = await tx.priceList.findUnique({
      where: { rabVersionId: versionId },
      select: {
        id: true,
        versionNumber: true,
        location: true,
        period: true,
        items: { orderBy: { id: 'asc' } },
      },
    });
    const analyses = await tx.ahspAnalysisVersion.findMany({
      where: { analysis: { rabVersionId: versionId } },
      include: { components: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
      orderBy: { id: 'asc' },
    });
    const payload: RabSnapshotPayload = {
      schema: 1,
      version: {
        id: version.id,
        projectId: v.projectId,
        versionType: version.versionType,
        revisionNumber: version.revisionNumber,
        label: version.label,
        documentNumber: version.documentNumber,
        documentDate: version.documentDate,
        previousVersionId: version.previousVersionId,
        approvedBy: v.approvedBy,
        approvedAt: v.approvedAt?.toISOString() ?? null,
      },
      totals,
      rows: rows.map((r) => ({ ...r, previousVersionItemId: copies.get(r.id) ?? null })),
      package: {
        priceList: priceList && {
          id: priceList.id,
          versionNumber: priceList.versionNumber,
          location: priceList.location,
          period: priceList.period,
        },
        priceItems: (priceList?.items ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unit,
          price: num(p.price)!,
          copiedFromId: p.copiedFromId,
          sourceLocator: p.sourceLocator,
        })),
        analyses: analyses.map((a) => ({
          id: a.id,
          analysisId: a.analysisId,
          versionNumber: a.versionNumber,
          code: a.code,
          name: a.name,
          unit: a.unit,
          overheadPercent: num(a.overheadPercent),
          roundingScale: a.roundingScale,
          directCost: num(a.directCost)!,
          overheadAmount: num(a.overheadAmount)!,
          priceExact: num(a.priceExact)!,
          price: num(a.price)!,
          copiedFromId: a.copiedFromId,
          sourceImportId: a.sourceImportId,
          sourceLocator: a.sourceLocator,
          components: a.components.map((c) => ({
            id: c.id,
            sortOrder: c.sortOrder,
            category: c.category,
            description: c.description,
            unit: c.unit,
            coefficient: num(c.coefficient)!,
            unitPrice: num(c.unitPrice)!,
            amount: num(c.amount)!,
            priceItemId: c.priceItemId,
            subAnalysisVersionId: c.subAnalysisVersionId,
            subPriceBasis: c.subPriceBasis,
            sourceLocator: c.sourceLocator,
          })),
        })),
      },
    };
    // Stored as parsed canonical JSON: no undefined, and the checksum covers exactly what is stored.
    return JSON.parse(canonicalJson(payload)) as RabSnapshotPayload;
  }

  /**
   * D-070: abandons a correction. The REOPENED version gets back exactly its last approved snapshot (rows,
   * package values, document data, approval) and is APPROVED again; the corrections stay in the audit history.
   * The result is checked against the snapshot checksum, so an incomplete restore never commits.
   */
  async cancelCorrection(actor: AuthUser, projectId: string, versionId: string, reason: string): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const { status } = await this.lockVersion(tx, projectId, versionId);
      if (status !== 'REOPENED')
        throw new ConflictException('Hanya versi yang sedang dikoreksi yang dapat dibatalkan koreksinya.');
      const snapshot = await tx.rabVersionSnapshot.findFirst({
        where: { rabVersionId: versionId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true, payload: true, checksum: true },
      });
      if (!snapshot) throw new ConflictException('Snapshot approved tidak ditemukan; koreksi tidak dapat dibatalkan.');
      const target = snapshot.payload as unknown as RabSnapshotPayload;
      const current = await this.snapshotPayload(tx, projectId, versionId);
      const json = (value: unknown) => (value ?? Prisma.DbNull) as Prisma.InputJsonValue;
      const differs = <T extends { id: string }>(was: T[], want: T[]) => {
        const before = new Map(was.map((x) => [x.id, canonicalJson(x)]));
        return want.filter((x) => before.get(x.id) !== canonicalJson(x));
      };

      // Rows added during the correction go, deepest first; a work item created for them and used nowhere else too.
      const keep = new Set(target.rows.map((r) => r.id));
      const added = current.rows.filter((r) => !keep.has(r.id)).sort((a, b) => b.depth - a.depth);
      for (const r of added) await tx.rabVersionItem.delete({ where: { id: r.id } });
      const addedWorkItems = added.flatMap((r) => (r.workItemId ? [r.workItemId] : []));
      if (addedWorkItems.length)
        await tx.workItem.deleteMany({ where: { id: { in: addedWorkItems }, versionItems: { none: {} } } });

      // Work items are unique per version: free the changed ones before writing them back.
      const changedRows = differs(current.rows, target.rows);
      await tx.rabVersionItem.updateMany({
        where: { id: { in: changedRows.map((r) => r.id) } },
        data: { workItemId: null },
      });
      const position = new Map<string, number>();
      const siblings = new Map<string | null, number>();
      for (const r of target.rows) {
        const n = (siblings.get(r.parentId) ?? 0) + 1;
        siblings.set(r.parentId, n);
        position.set(r.id, n);
      }
      const reordered = new Set(current.rows.filter((r, i) => target.rows[i]?.id !== r.id).map((r) => r.id));
      for (const r of target.rows) {
        if (!changedRows.includes(r) && !reordered.has(r.id)) continue;
        await tx.rabVersionItem.update({
          where: { id: r.id },
          data: {
            parentItemId: r.parentId,
            sortOrder: position.get(r.id)!,
            rowType: r.rowType,
            workItemId: r.workItemId,
            displayNumber: r.displayNumber,
            description: r.description,
            volume: r.volume,
            unit: r.unit,
            analysisCode: r.analysisCode,
            unitPrice: r.unitPrice,
            taxPercent: r.taxPercent,
            unitPriceWithTax: r.unitPriceWithTax,
            subtotal: r.subtotal,
            previousVersionItemId: r.previousVersionItemId,
            analysisVersionId: r.analysis?.versionId ?? null,
            priceSource: r.priceSource,
            sourceUnitPrice: r.sourceUnitPrice,
            analysisUnitPrice: r.analysisUnitPrice,
            priceNote: r.priceNote,
            priceDecidedAt: r.priceDecidedAt ? new Date(r.priceDecidedAt) : null,
            sourceLocator: json(r.sourceLocator),
          },
        });
      }

      for (const p of differs(current.package.priceItems, target.package.priceItems))
        await tx.priceItem.update({
          where: { id: p.id },
          data: { name: p.name, unit: p.unit, price: p.price, sourceLocator: json(p.sourceLocator) },
        });
      const strip = (a: RabSnapshotPayload['package']['analyses'][number]) => ({ ...a, components: [] });
      for (const a of differs(current.package.analyses.map(strip), target.package.analyses.map(strip)))
        await tx.ahspAnalysisVersion.update({
          where: { id: a.id },
          data: {
            code: a.code,
            name: a.name,
            unit: a.unit,
            overheadPercent: a.overheadPercent,
            roundingScale: a.roundingScale,
            directCost: a.directCost,
            overheadAmount: a.overheadAmount,
            priceExact: a.priceExact,
            price: a.price,
            sourceLocator: json(a.sourceLocator),
          },
        });
      const components = (pkg: RabSnapshotPayload['package']) => pkg.analyses.flatMap((a) => a.components);
      for (const c of differs(components(current.package), components(target.package)))
        await tx.ahspComponent.update({
          where: { id: c.id },
          data: {
            sortOrder: c.sortOrder,
            description: c.description,
            unit: c.unit,
            coefficient: c.coefficient,
            unitPrice: c.unitPrice,
            amount: c.amount,
            sourceLocator: json(c.sourceLocator),
          },
        });

      await tx.rabVersion.update({
        where: { id: versionId },
        data: {
          status: 'APPROVED',
          documentNumber: target.version.documentNumber,
          documentDate: target.version.documentDate ? toDbDate(target.version.documentDate) : null,
          totalBeforeTax: target.totals.beforeTax,
          totalTax: target.totals.tax,
          totalValue: target.totals.value,
          approvedBy: target.version.approvedBy,
          approvedAt: target.version.approvedAt ? new Date(target.version.approvedAt) : null,
        },
      });
      if (checksumOf(await this.snapshotPayload(tx, projectId, versionId)) !== snapshot.checksum)
        throw new ConflictException(
          'Kondisi hasil pemulihan tidak sama persis dengan snapshot approved terakhir; koreksi tidak dibatalkan. Selesaikan koreksi lalu approve ulang.',
        );
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'CANCEL_RAB_CORRECTION',
        entityType: 'RAB_VERSION',
        entityId: versionId,
        projectId,
        reason,
        oldValue: { status: 'REOPENED' },
        newValue: { status: 'APPROVED', restoredSnapshot: snapshot.sequence, checksum: snapshot.checksum, removedRows: added.length },
      });
    });
    return this.get(projectId, versionId);
  }

  private async findVersion(projectId: string, versionId: string): Promise<void> {
    if (!(await this.prisma.rabVersion.findFirst({ where: { id: versionId, projectId }, select: { id: true } })))
      throw new NotFoundException('Versi RAB tidak ditemukan.');
  }

  private async findItem(tx: Db, versionId: string, itemId: string) {
    const item = await tx.rabVersionItem.findFirst({
      where: { id: itemId, rabVersionId: versionId },
      select: {
        id: true,
        rowType: true,
        parentItemId: true,
        sortOrder: true,
        workItemId: true,
        analysisVersionId: true,
        displayNumber: true,
        description: true,
        volume: true,
        unit: true,
        analysisCode: true,
        unitPrice: true,
        taxPercent: true,
        sourceLocator: true,
        createdAt: true,
      },
    });
    if (!item) throw new NotFoundException('Baris RAB tidak ditemukan.');
    return item;
  }

  /** SECTION only at the top; a parent is a non-ITEM row of the same version and never the row itself or its descendant. */
  private async assertValidParent(
    tx: Db,
    versionId: string,
    rowType: string,
    parentId: string | null,
    itemId?: string,
  ): Promise<void> {
    if (rowType === 'SECTION' && parentId !== null)
      throw new BadRequestException('SECTION hanya boleh di tingkat teratas.');
    if (parentId === null) return;
    const rows = await tx.rabVersionItem.findMany({
      where: { rabVersionId: versionId },
      select: { id: true, parentItemId: true, rowType: true },
    });
    const parent = rows.find((r) => r.id === parentId);
    if (!parent) throw new BadRequestException('Induk baris tidak ditemukan di versi ini.');
    if (parent.rowType === 'ITEM')
      throw new BadRequestException('Baris ITEM tidak dapat memiliki sub-baris.');
    // Walk up from the new parent: reaching the row itself means self- or descendant-parent (A → B → A).
    const parentOf = new Map(rows.map((r) => [r.id, r.parentItemId]));
    const seen = new Set<string>();
    for (
      let cursor: string | null = parentId;
      cursor !== null && !seen.has(cursor);
      cursor = parentOf.get(cursor) ?? null
    ) {
      if (cursor === itemId)
        throw new BadRequestException(
          'Baris tidak dapat dipindahkan ke dalam dirinya sendiri atau sub-barisnya.',
        );
      seen.add(cursor);
    }
  }

  private async nextSortOrder(tx: Db, versionId: string, parentId: string | null): Promise<number> {
    const last = await tx.rabVersionItem.aggregate({
      where: { rabVersionId: versionId, parentItemId: parentId },
      _max: { sortOrder: true },
    });
    return (last._max.sortOrder ?? 0) + 1;
  }

  /** WI-0001, WI-0002, … per project; the project row lock makes the sequence safe. */
  private async newWorkItem(tx: Db, projectId: string, description: string): Promise<string> {
    const workItem = await tx.workItem.create({
      data: {
        projectId,
        internalCode: workItemCode(await nextWorkItemNumber(tx, projectId)),
        canonicalDescription: description,
      },
    });
    return workItem.id;
  }
}

export const workItemCode = (n: number) => `WI-${String(n).padStart(4, '0')}`;

/**
 * Next work item number by numeric maximum: ordering the codes as text puts "WI-9999" after "WI-10000"
 * and would hand out WI-10000 twice.
 */
export async function nextWorkItemNumber(tx: Db, projectId: string): Promise<number> {
  const [row] = await tx.$queryRaw<{ last: bigint | number | null }[]>`
    SELECT MAX(CAST(SUBSTRING(internal_code, 4) AS UNSIGNED)) AS last FROM work_items WHERE project_id = ${projectId}`;
  return Number(row?.last ?? 0) + 1;
}
