import { randomUUID } from 'node:crypto';
import { aggregateRabGroups, calculateRab, Decimal, rabTotals, type RabRowValues } from '@laporan-proyek/calc';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  rabVersionLabel,
  type CreateRabItemInput,
  type CreateRabVersionInput,
  type RabChangeType,
  type RabCompareDto,
  type RabIssue,
  type RabRowDto,
  type RabTotalsDto,
  type RabVersionDetailDto,
  type RabVersionSummaryDto,
  type UpdateRabItemInput,
  type UpdateRabVersionInput,
} from '@laporan-proyek/shared';
import { writeAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fromDbDate, toDbDate } from '../projects/project-calendar';

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
} as const satisfies Prisma.RabVersionItemSelect;
type ItemRow = Prisma.RabVersionItemGetPayload<{ select: typeof ITEM_SELECT }>;

const ITEM_ONLY_FIELDS = ['volume', 'unit', 'analysisCode', 'unitPrice', 'taxPercent'] as const;
const NOT_DRAFT = 'Versi RAB ini sudah tidak berstatus draft dan tidak dapat diubah.';
/** Snapshot columns (D-043): integer digits each can hold; larger values would fail or truncate on approval. */
const LIMITS = { unitPriceWithTax: 20, subtotal: 30, total: 32 } as const;
const exceeds = (value: string | null, integerDigits: number) => value !== null && new Decimal(value).abs().gte(new Decimal(10).pow(integerDigits));

/** Exact decimal string without trailing zeros or exponent (DB scale padding is not meaningful). */
const num = (value: Prisma.Decimal | null) => (value === null ? null : new Decimal(value.toString()).toFixed());

/** Depth-first order by sort_order, with depth (the grid and exports show the hierarchy). */
function treeOrder(items: ItemRow[]): (ItemRow & { depth: number })[] {
  const byParent = new Map<string | null, ItemRow[]>();
  for (const item of items) byParent.set(item.parentItemId, [...(byParent.get(item.parentItemId) ?? []), item]);
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
function rowValues(status: string, items: ItemRow[]): { values: Map<string, RabRowValues>; totals: RabTotalsDto } {
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
    const itemBeforeTax = i.volume && i.unitPrice ? new Decimal(i.volume.toString()).times(i.unitPrice.toString()) : null;
    if (itemBeforeTax) beforeTax = beforeTax.plus(itemBeforeTax);
    if (i.subtotal) value = value.plus(i.subtotal.toString());
    values.set(i.id, { unitPriceWithTax: num(i.unitPriceWithTax), subtotalBeforeTax: itemBeforeTax?.toFixed() ?? null, subtotal: num(i.subtotal), weight: null });
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
    totals: v.status === 'APPROVED' ? rabTotals(v.totalBeforeTax!.toString(), v.totalValue!.toString()) : totals,
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
function validate(rows: RabRowDto[], totals: RabTotalsDto, contractValue: string | null, versionType: string): { errors: RabIssue[]; warnings: RabIssue[] } {
  const errors: RabIssue[] = [];
  const warnings: RabIssue[] = [];
  const items = rows.filter((r) => r.rowType === 'ITEM');
  if (items.length === 0) errors.push({ message: 'RAB belum memiliki baris pekerjaan (ITEM).' });
  for (const r of items) {
    const missing = [!r.unit && 'satuan', r.volume === null && 'volume', r.unitPrice === null && 'harga satuan', r.taxPercent === null && 'PPN'].filter(Boolean);
    if (missing.length) errors.push({ itemId: r.id, message: `${r.displayNumber ?? ''} ${r.description}: ${missing.join(', ')} belum diisi.`.trim() });
    else if (r.volume !== null && new Decimal(r.volume).isZero()) warnings.push({ itemId: r.id, message: `${r.displayNumber ?? ''} ${r.description}: volume 0.`.trim() });
  }
  // Valid inputs can still overflow DECIMAL(20,2) after tax or multiplication; block before the snapshot is stored.
  for (const r of items) {
    const label = `${r.displayNumber ?? ''} ${r.description}`.trim();
    if (exceeds(r.unitPriceWithTax, LIMITS.unitPriceWithTax)) errors.push({ itemId: r.id, message: `${label}: harga + PPN melebihi batas nilai yang dapat disimpan (maks. 20 digit rupiah).` });
    else if (exceeds(r.subtotal, LIMITS.subtotal)) errors.push({ itemId: r.id, message: `${label}: jumlah (volume × harga + PPN) melebihi batas nilai yang dapat disimpan.` });
  }
  if (exceeds(totals.value, LIMITS.total) || exceeds(totals.beforeTax, LIMITS.total)) errors.push({ message: 'Total RAB melebihi batas nilai yang dapat disimpan (maks. 32 digit rupiah).' });
  const hasChild = new Set(rows.map((r) => r.parentId));
  for (const r of rows) if (r.rowType !== 'ITEM' && !hasChild.has(r.id)) warnings.push({ itemId: r.id, message: `${r.displayNumber ?? ''} ${r.description}: tidak memiliki sub-baris.`.trim() });
  // The contract may state the REAL COST or the DIBULATKAN figure (D-043).
  if (versionType === 'CONTRACT' && contractValue !== null && !new Decimal(contractValue).equals(totals.realCost) && !new Decimal(contractValue).equals(totals.rounded)) {
    warnings.push({ message: `Total RAB Kontrak (${totals.realCost}; dibulatkan ${totals.rounded}) berbeda dengan nilai kontrak proyek (${contractValue}).` });
  }
  return { errors, warnings };
}

const sameDecimal = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new Decimal(a).equals(b));

@Injectable()
export class RabService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string): Promise<RabVersionSummaryDto[]> {
    const versions = await this.prisma.rabVersion.findMany({ where: { projectId }, select: VERSION_SELECT, orderBy: { createdAt: 'asc' } });
    return Promise.all(
      versions.map(async (v) => {
        const items = await this.prisma.rabVersionItem.findMany({ where: { rabVersionId: v.id }, select: ITEM_SELECT });
        const { totals } = rowValues(v.status, items);
        return toSummary(v, totals, items.filter((i) => i.rowType === 'ITEM').length);
      }),
    );
  }

  async get(projectId: string, versionId: string): Promise<RabVersionDetailDto> {
    return this.detail(this.prisma, projectId, versionId);
  }

  /** CONTRACT starts empty; MC0/ADDENDUM copy the latest approved version (D-040). One DRAFT per project. */
  async create(actor: AuthUser, projectId: string, input: CreateRabVersionInput): Promise<RabVersionDetailDto> {
    const versionId = await this.prisma.$transaction(async (tx) => {
      await this.lockActiveProject(tx, projectId);
      const versions = await tx.rabVersion.findMany({
        where: { projectId, status: { not: 'DISCARDED' } },
        select: { id: true, versionType: true, revisionNumber: true, status: true, approvedAt: true },
      });
      if (versions.some((v) => v.status === 'DRAFT')) throw new ConflictException('Masih ada draft RAB; approve atau batalkan draft tersebut lebih dahulu.');
      const approved = versions.filter((v) => v.status === 'APPROVED').sort((a, b) => a.approvedAt!.getTime() - b.approvedAt!.getTime());
      const latest = approved.at(-1);

      let revisionNumber = 0;
      if (input.versionType === 'CONTRACT') {
        if (versions.length > 0) throw new ConflictException('RAB Kontrak sudah ada.');
      } else if (!latest) {
        throw new ConflictException('RAB Kontrak harus di-approve sebelum membuat MC-0 atau Addendum.');
      } else if (input.versionType === 'MC0') {
        if (versions.some((v) => v.versionType !== 'CONTRACT')) throw new ConflictException('MC-0 hanya dapat dibuat satu kali dan sebelum Addendum.');
      } else {
        revisionNumber = Math.max(0, ...versions.filter((v) => v.versionType === 'ADDENDUM').map((v) => v.revisionNumber)) + 1;
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
      if (input.versionType !== 'CONTRACT') await this.copyItems(tx, latest!.id, version.id);
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
      return version.id;
    });
    return this.get(projectId, versionId);
  }

  async updateVersion(actor: AuthUser, projectId: string, versionId: string, input: UpdateRabVersionInput): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.lockDraft(tx, projectId, versionId);
      const current = { documentNumber: version.documentNumber, documentDate: version.documentDate ? fromDbDate(version.documentDate) : null };
      const next = {
        documentNumber: input.documentNumber === undefined ? current.documentNumber : input.documentNumber,
        documentDate: input.documentDate === undefined ? current.documentDate : input.documentDate,
      };
      if (next.documentNumber === current.documentNumber && next.documentDate === current.documentDate) return;
      await tx.rabVersion.update({
        where: { id: versionId },
        data: { documentNumber: next.documentNumber, documentDate: next.documentDate ? toDbDate(next.documentDate) : null },
      });
      await writeAudit(tx, { actorId: actor.id, action: 'UPDATE_RAB_VERSION', entityType: 'RAB_VERSION', entityId: versionId, projectId, oldValue: current, newValue: next });
    });
    return this.get(projectId, versionId);
  }

  async addItem(projectId: string, versionId: string, input: CreateRabItemInput): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, projectId, versionId);
      const parentId = input.parentId ?? null;
      await this.assertValidParent(tx, versionId, input.rowType, parentId);
      const { rowType, ...fields } = input;
      if (rowType !== 'ITEM' && ITEM_ONLY_FIELDS.some((f) => fields[f] != null)) {
        throw new BadRequestException('Hanya baris ITEM yang memiliki volume, satuan, no analisa, harga, dan PPN.');
      }
      const workItemId = rowType === 'ITEM' ? await this.newWorkItem(tx, projectId, input.description) : null;
      await tx.rabVersionItem.create({
        data: {
          displayNumber: fields.displayNumber,
          description: fields.description,
          volume: fields.volume,
          unit: fields.unit,
          analysisCode: fields.analysisCode,
          unitPrice: fields.unitPrice,
          taxPercent: fields.taxPercent,
          rabVersionId: versionId,
          parentItemId: parentId,
          rowType,
          workItemId,
          sortOrder: await this.nextSortOrder(tx, versionId, parentId),
        },
      });
    });
    return this.get(projectId, versionId);
  }

  async updateItem(projectId: string, versionId: string, itemId: string, input: UpdateRabItemInput): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, projectId, versionId);
      const item = await this.findItem(tx, versionId, itemId);
      const { parentId, ...fields } = input;
      if (item.rowType !== 'ITEM' && ITEM_ONLY_FIELDS.some((f) => fields[f] != null)) {
        throw new BadRequestException('Hanya baris ITEM yang memiliki volume, satuan, no analisa, harga, dan PPN.');
      }
      const data: Prisma.RabVersionItemUncheckedUpdateInput = { ...fields };
      if (parentId !== undefined && parentId !== item.parentItemId) {
        await this.assertValidParent(tx, versionId, item.rowType, parentId, itemId);
        data.parentItemId = parentId;
        data.sortOrder = await this.nextSortOrder(tx, versionId, parentId);
      }
      await tx.rabVersionItem.update({ where: { id: itemId }, data });
    });
    return this.get(projectId, versionId);
  }

  async deleteItem(projectId: string, versionId: string, itemId: string): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, projectId, versionId);
      const item = await this.findItem(tx, versionId, itemId);
      if (await tx.rabVersionItem.count({ where: { parentItemId: itemId } })) throw new ConflictException('Hapus atau pindahkan sub-baris lebih dahulu.');
      await tx.rabVersionItem.delete({ where: { id: itemId } });
      // A work item created in this draft and used nowhere else goes too; copied ones stay (history).
      if (item.workItemId) await tx.workItem.deleteMany({ where: { id: item.workItemId, versionItems: { none: {} } } });
    });
    return this.get(projectId, versionId);
  }

  async moveItem(projectId: string, versionId: string, itemId: string, direction: 'up' | 'down'): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, projectId, versionId);
      const item = await this.findItem(tx, versionId, itemId);
      const sibling = await tx.rabVersionItem.findFirst({
        where: { rabVersionId: versionId, parentItemId: item.parentItemId, sortOrder: direction === 'up' ? { lt: item.sortOrder } : { gt: item.sortOrder } },
        orderBy: { sortOrder: direction === 'up' ? 'desc' : 'asc' },
        select: { id: true, sortOrder: true },
      });
      if (!sibling) return;
      await tx.rabVersionItem.update({ where: { id: item.id }, data: { sortOrder: sibling.sortOrder } });
      await tx.rabVersionItem.update({ where: { id: sibling.id }, data: { sortOrder: item.sortOrder } });
    });
    return this.get(projectId, versionId);
  }

  /** Validates, stores per-row and total snapshots, and locks the version (D-040, D-042). */
  async approve(actor: AuthUser, projectId: string, versionId: string, acknowledgeWarnings: boolean): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, projectId, versionId);
      const { rows, totals, issues } = await this.detail(tx, projectId, versionId);
      if (issues.errors.length) throw new ConflictException({ message: 'RAB belum dapat di-approve.', errors: issues.errors, warnings: issues.warnings });
      if (issues.warnings.length && !acknowledgeWarnings) {
        throw new ConflictException({ message: 'Konfirmasi peringatan sebelum approve.', errors: [], warnings: issues.warnings });
      }
      for (const row of rows.filter((r) => r.rowType === 'ITEM')) {
        await tx.rabVersionItem.update({ where: { id: row.id }, data: { unitPriceWithTax: row.unitPriceWithTax, subtotal: row.subtotal } });
      }
      const approvedAt = new Date();
      await tx.rabVersion.update({
        where: { id: versionId },
        data: { status: 'APPROVED', totalBeforeTax: totals.beforeTax, totalTax: totals.tax, totalValue: totals.value, approvedBy: actor.id, approvedAt },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'APPROVE_RAB_VERSION',
        entityType: 'RAB_VERSION',
        entityId: versionId,
        projectId,
        oldValue: { status: 'DRAFT' },
        newValue: {
          status: 'APPROVED',
          ...totals,
          itemCount: rows.filter((r) => r.rowType === 'ITEM').length,
          acknowledgedWarnings: issues.warnings.map((w) => w.message),
        },
      });
    });
    return this.get(projectId, versionId);
  }

  async discard(actor: AuthUser, projectId: string, versionId: string, reason: string): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, projectId, versionId);
      await tx.rabVersion.update({ where: { id: versionId }, data: { status: 'DISCARDED', discardedBy: actor.id, discardedAt: new Date(), discardReason: reason } });
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

  /** ITEM rows matched by permanent work item (PRD §9-10); group rows are not compared. */
  async compare(projectId: string, baseId: string, targetId: string): Promise<RabCompareDto> {
    const [base, target] = await Promise.all([this.get(projectId, baseId), this.get(projectId, targetId)]);
    const baseItems = new Map(base.rows.filter((r) => r.rowType === 'ITEM').map((r) => [r.workItemId!, r]));
    const targetItems = target.rows.filter((r) => r.rowType === 'ITEM');
    const rows: RabCompareDto['rows'] = targetItems.map((t) => {
      const b = baseItems.get(t.workItemId!) ?? null;
      const change: RabChangeType = !b
        ? 'NEW'
        : b.description !== t.description ||
            b.unit !== t.unit ||
            b.analysisCode !== t.analysisCode ||
            !sameDecimal(b.volume, t.volume) ||
            !sameDecimal(b.unitPrice, t.unitPrice) ||
            !sameDecimal(b.taxPercent, t.taxPercent)
          ? 'MODIFIED'
          : 'UNCHANGED';
      return { workItemId: t.workItemId!, workItemCode: t.workItemCode!, change, base: b, target: t };
    });
    const inTarget = new Set(targetItems.map((t) => t.workItemId));
    for (const b of baseItems.values()) {
      if (!inTarget.has(b.workItemId)) rows.push({ workItemId: b.workItemId!, workItemCode: b.workItemCode!, change: 'REMOVED', base: b, target: null });
    }
    return { base: base.version, target: target.version, rows };
  }

  private async detail(db: Db, projectId: string, versionId: string): Promise<RabVersionDetailDto> {
    const version = await db.rabVersion.findFirst({ where: { id: versionId, projectId }, select: VERSION_SELECT });
    if (!version) throw new NotFoundException('Versi RAB tidak ditemukan.');
    const items = await db.rabVersionItem.findMany({ where: { rabVersionId: versionId }, select: ITEM_SELECT });
    const { values, totals: computed } = rowValues(version.status, items);
    const rows = toRows(items, values);
    const summary = toSummary(version, computed, rows.filter((r) => r.rowType === 'ITEM').length);
    let issues: RabVersionDetailDto['issues'] = { errors: [], warnings: [] };
    if (version.status === 'DRAFT') {
      const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { contractValue: true } });
      issues = validate(rows, summary.totals, project.contractValue?.toFixed(2) ?? null, version.versionType);
    }
    return { version: summary, rows, totals: summary.totals, issues };
  }

  /** Copies rows in tree order so parents exist before children; ids are generated here for createMany. */
  private async copyItems(tx: Db, fromVersionId: string, toVersionId: string): Promise<void> {
    const source = treeOrder(await tx.rabVersionItem.findMany({ where: { rabVersionId: fromVersionId }, select: ITEM_SELECT }));
    const newIds = new Map(source.map((i) => [i.id, randomUUID()]));
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
      })),
    });
  }

  /** Project row lock first, then the version, so every RAB write on a project serializes. */
  private async lockActiveProject(tx: Db, projectId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { status: true } });
    if (!project) throw new NotFoundException('Proyek tidak ditemukan.');
    if (project.status === 'CLOSED') throw new ConflictException('Proyek sudah ditutup; RAB tidak dapat diubah.');
  }

  private async lockDraft(tx: Db, projectId: string, versionId: string) {
    await this.lockActiveProject(tx, projectId);
    const version = await tx.rabVersion.findFirst({ where: { id: versionId, projectId }, select: { status: true, documentNumber: true, documentDate: true } });
    if (!version) throw new NotFoundException('Versi RAB tidak ditemukan.');
    if (version.status !== 'DRAFT') throw new ConflictException(NOT_DRAFT);
    return version;
  }

  private async findItem(tx: Db, versionId: string, itemId: string) {
    const item = await tx.rabVersionItem.findFirst({
      where: { id: itemId, rabVersionId: versionId },
      select: { id: true, rowType: true, parentItemId: true, sortOrder: true, workItemId: true },
    });
    if (!item) throw new NotFoundException('Baris RAB tidak ditemukan.');
    return item;
  }

  /** SECTION only at the top; a parent is a non-ITEM row of the same version and never the row itself or its descendant. */
  private async assertValidParent(tx: Db, versionId: string, rowType: string, parentId: string | null, itemId?: string): Promise<void> {
    if (rowType === 'SECTION' && parentId !== null) throw new BadRequestException('SECTION hanya boleh di tingkat teratas.');
    if (parentId === null) return;
    const rows = await tx.rabVersionItem.findMany({ where: { rabVersionId: versionId }, select: { id: true, parentItemId: true, rowType: true } });
    const parent = rows.find((r) => r.id === parentId);
    if (!parent) throw new BadRequestException('Induk baris tidak ditemukan di versi ini.');
    if (parent.rowType === 'ITEM') throw new BadRequestException('Baris ITEM tidak dapat memiliki sub-baris.');
    // Walk up from the new parent: reaching the row itself means self- or descendant-parent (A → B → A).
    const parentOf = new Map(rows.map((r) => [r.id, r.parentItemId]));
    const seen = new Set<string>();
    for (let cursor: string | null = parentId; cursor !== null && !seen.has(cursor); cursor = parentOf.get(cursor) ?? null) {
      if (cursor === itemId) throw new BadRequestException('Baris tidak dapat dipindahkan ke dalam dirinya sendiri atau sub-barisnya.');
      seen.add(cursor);
    }
  }

  private async nextSortOrder(tx: Db, versionId: string, parentId: string | null): Promise<number> {
    const last = await tx.rabVersionItem.aggregate({ where: { rabVersionId: versionId, parentItemId: parentId }, _max: { sortOrder: true } });
    return (last._max.sortOrder ?? 0) + 1;
  }

  /** WI-0001, WI-0002, … per project; the project row lock makes the sequence safe. */
  private async newWorkItem(tx: Db, projectId: string, description: string): Promise<string> {
    const last = await tx.workItem.findFirst({ where: { projectId }, orderBy: { internalCode: 'desc' }, select: { internalCode: true } });
    const next = (last ? Number(last.internalCode.slice(3)) : 0) + 1;
    const workItem = await tx.workItem.create({ data: { projectId, internalCode: `WI-${String(next).padStart(4, '0')}`, canonicalDescription: description } });
    return workItem.id;
  }
}
