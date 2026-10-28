import {
  applyPriceFactor,
  Decimal,
  recalculatePackage,
  type PackageEdit,
  type PriceFactor,
} from '@laporan-proyek/calc';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CorrectAnalysisInput,
  CorrectComponentInput,
  CorrectPriceItemInput,
  CorrectWorkItemInput,
  RabVersionDetailDto,
} from '@laporan-proyek/shared';
import { checkPackageIsolation, isIsolated } from '../ahsp/package';
import type { AuthUser } from '../auth/auth-context';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { changedFields, fitsScale, withCorrection } from './provenance';
import { RabService } from './rab.service';

type Db = Prisma.TransactionClient;
const num = (v: { toString(): string } | null) => (v === null ? null : new Decimal(v.toString()).toFixed());
/** Column scales (schema.prisma); a recalculated value that needs more is refused, never rounded silently. */
const SCALE = { coefficient: 12, unitPrice: 12, amount: 24, cost: 24, price: 12, rabPrice: 2 } as const;

/**
 * D-068 corrections at the source of a value, inside one version's package: base price, coefficient or manual
 * component price, overhead/rounding. Dependents are recalculated with the pure calc function and written with
 * provenance marks and one audit entry, in the caller's single transaction.
 */
@Injectable()
export class RabCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rab: RabService,
  ) {}

  async correctPriceItem(actor: AuthUser, projectId: string, versionId: string, priceItemId: string, input: CorrectPriceItemInput) {
    return this.correct(actor, projectId, versionId, input.reason, 'CORRECT_PRICE_ITEM', async (tx) => {
      const item = await tx.priceItem.findFirst({ where: { id: priceItemId, priceList: { rabVersionId: versionId } } });
      if (!item) throw new NotFoundException('Harga dasar tidak ditemukan di paket versi RAB ini.');
      // A unit change is a label only: the price edit then repeats the current price and recalculates nothing.
      return {
        edit: { kind: 'PRICE_ITEM', priceItemId, price: input.price ?? num(item.price)! },
        target: { priceItemId, name: item.name },
        changes: changedFields({ price: num(item.price), unit: item.unit }, { price: input.price ?? undefined, unit: input.unit }),
      };
    });
  }

  async correctComponent(actor: AuthUser, projectId: string, versionId: string, componentId: string, input: CorrectComponentInput) {
    return this.correct(actor, projectId, versionId, input.reason, 'CORRECT_AHSP_COMPONENT', async (tx) => {
      const c = await tx.ahspComponent.findFirst({ where: { id: componentId, analysisVersion: { analysis: { rabVersionId: versionId } } } });
      if (!c) throw new NotFoundException('Komponen analisa tidak ditemukan di paket versi RAB ini.');
      const factorText = (f: PriceFactor | null | undefined) => (f ? `${f.op}${f.value}` : null);
      return {
        edit: { kind: 'COMPONENT', componentId, coefficient: input.coefficient ?? undefined, unitPrice: input.unitPrice ?? undefined, factor: input.factor },
        target: { componentId, analysisVersionId: c.analysisVersionId, description: c.description },
        changes: changedFields(
          { coefficient: num(c.coefficient), unitPrice: num(c.unitPrice), factor: factorText(factorOf(c.sourceLocator)) },
          {
            coefficient: input.coefficient ?? undefined,
            unitPrice: input.unitPrice ?? undefined,
            factor: input.factor === undefined ? undefined : factorText(input.factor),
          },
        ),
      };
    });
  }

  async correctAnalysis(actor: AuthUser, projectId: string, versionId: string, analysisVersionId: string, input: CorrectAnalysisInput) {
    return this.correct(actor, projectId, versionId, input.reason, 'CORRECT_AHSP_ANALYSIS', async (tx) => {
      const a = await tx.ahspAnalysisVersion.findFirst({ where: { id: analysisVersionId, analysis: { rabVersionId: versionId } } });
      if (!a) throw new NotFoundException('Analisa tidak ditemukan di paket versi RAB ini.');
      return {
        edit: { kind: 'ANALYSIS', analysisVersionId, overheadPercent: input.overheadPercent, roundingScale: input.roundingScale },
        target: { analysisVersionId, code: a.code, name: a.name },
        changes: changedFields(
          { overheadPercent: num(a.overheadPercent), roundingScale: a.roundingScale },
          { overheadPercent: input.overheadPercent, roundingScale: input.roundingScale },
        ),
      };
    });
  }

  /**
   * Re-points an item at the work item it really continues from the previous version (e.g. a kWh meter matched
   * to a new WI by mistake). The old work item and every snapshot that used it stay; nothing global is renamed.
   */
  async correctWorkItem(actor: AuthUser, projectId: string, versionId: string, itemId: string, input: CorrectWorkItemInput): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const version = await this.rab.lockEditable(tx, actor, projectId, versionId, input.reason);
      const item = await tx.rabVersionItem.findFirst({
        where: { id: itemId, rabVersionId: versionId },
        select: { rowType: true, workItemId: true, previousVersionItemId: true, sourceLocator: true, workItem: { select: { internalCode: true } } },
      });
      if (!item) throw new NotFoundException('Baris RAB tidak ditemukan.');
      if (item.rowType !== 'ITEM') throw new BadRequestException('Hanya baris ITEM yang memiliki identitas pekerjaan.');
      if (!version.previousVersionId) throw new ConflictException('Versi ini tidak mempunyai versi sebelumnya untuk dicocokkan.');
      if (item.workItemId === input.workItemId) throw new BadRequestException('Item sudah memakai pekerjaan tersebut.');
      const previous = await tx.rabVersionItem.findFirst({
        where: { rabVersionId: version.previousVersionId, workItemId: input.workItemId, workItem: { projectId } },
        select: { id: true, workItem: { select: { internalCode: true } } },
      });
      if (!previous) throw new BadRequestException('Pekerjaan yang dipilih bukan item versi sebelumnya pada proyek ini.');
      if (await tx.rabVersionItem.count({ where: { rabVersionId: versionId, workItemId: input.workItemId, id: { not: itemId } } }))
        throw new ConflictException(`${previous.workItem!.internalCode} sudah dipakai item lain pada versi ini.`);
      const changes = {
        workItem: [item.workItem?.internalCode ?? null, previous.workItem!.internalCode] as [string | null, string],
        previousVersionItemId: [item.previousVersionItemId, previous.id] as [string | null, string],
      };
      await tx.rabVersionItem.update({
        where: { id: itemId },
        data: {
          workItemId: input.workItemId,
          previousVersionItemId: previous.id,
          sourceLocator: withCorrection(item.sourceLocator, this.rab.mark(actor, input.reason, changes)),
        },
      });
      await this.rab.correctionAudit(tx, actor, projectId, versionId, input.reason, {
        action: 'CORRECT_RAB_WORK_ITEM',
        oldValue: { itemId, workItemId: item.workItemId, workItemCode: changes.workItem[0], previousVersionItemId: item.previousVersionItemId },
        newValue: { itemId, workItemId: input.workItemId, workItemCode: changes.workItem[1], previousVersionItemId: previous.id },
      });
    });
    return this.rab.get(projectId, versionId);
  }

  private async correct(
    actor: AuthUser,
    projectId: string,
    versionId: string,
    reason: string | undefined,
    action: 'CORRECT_PRICE_ITEM' | 'CORRECT_AHSP_COMPONENT' | 'CORRECT_AHSP_ANALYSIS',
    resolve: (tx: Db) => Promise<{ edit: PackageEdit; target: Prisma.InputJsonObject; changes: Record<string, [string | number | null, string | number | null]> }>,
  ): Promise<RabVersionDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.rab.lockEditable(tx, actor, projectId, versionId, reason);
      const { edit, target, changes } = await resolve(tx);
      if (!Object.keys(changes).length) throw new BadRequestException('Tidak ada perubahan.');
      await this.assertIsolated(tx, versionId);
      const pkg = await this.loadPackage(tx, versionId);
      let result: ReturnType<typeof recalculatePackage>;
      try {
        result = recalculatePackage(pkg.input, edit);
      } catch (err) {
        if (err instanceof RangeError) throw new ConflictException(err.message);
        throw err;
      }
      const directComponent = edit.kind === 'COMPONENT' ? edit.componentId : null;
      this.assertDerivable(pkg, result, directComponent);
      const problems: string[] = [];
      for (const [id, c] of result.components) {
        const label = pkg.components.get(id)!.description;
        if (!fitsScale(c.unitPrice, SCALE.unitPrice) || !fitsScale(c.amount, SCALE.amount) || !fitsScale(c.coefficient, SCALE.coefficient))
          problems.push(`Komponen ${label}: hasil ${c.unitPrice} × ${c.coefficient} melebihi presisi penyimpanan.`);
      }
      for (const [id, a] of result.analyses) {
        const label = pkg.analyses.get(id)!.label;
        if (!fitsScale(a.price, SCALE.price) || !fitsScale(a.priceExact, SCALE.cost) || !fitsScale(a.directCost, SCALE.cost) || !fitsScale(a.overheadAmount, SCALE.cost))
          problems.push(`Analisa ${label}: harga ${a.priceExact} melebihi presisi penyimpanan; tetapkan pembulatan analisa.`);
      }
      // RAB items: ANALYSIS items take the new analysis price; overrides/direct prices stay explicit decisions.
      const priceChanged = [...result.analyses].filter(([id, a]) => !new Decimal(a.price).equals(pkg.input.analyses.find((x) => x.id === id)!.price));
      const items = priceChanged.length
        ? await tx.rabVersionItem.findMany({
            where: { rabVersionId: versionId, analysisVersionId: { in: priceChanged.map(([id]) => id) } },
            select: { id: true, description: true, displayNumber: true, analysisVersionId: true, priceSource: true, unitPrice: true, analysisUnitPrice: true, sourceLocator: true },
          })
        : [];
      const newPrice = new Map(priceChanged.map(([id, a]) => [id, a.price]));
      for (const i of items)
        if (i.priceSource === 'ANALYSIS' && !fitsScale(newPrice.get(i.analysisVersionId!)!, SCALE.rabPrice))
          problems.push(
            `${i.displayNumber ?? ''} ${i.description}: harga analisa baru ${newPrice.get(i.analysisVersionId!)} lebih dari 2 desimal; tetapkan pembulatan analisa lebih dahulu (D-043).`.trim(),
          );
      if (problems.length) throw new ConflictException({ message: 'Koreksi tidak dapat disimpan tanpa pembulatan diam-diam.', errors: problems.map((message) => ({ message })) });

      const mark = (kind: 'MANUAL' | 'RECALCULATED', c: Record<string, [string | number | null, string | number | null]>) => this.rab.mark(actor, reason, c, kind);
      const recalculated: Prisma.InputJsonObject[] = [];
      if (edit.kind === 'PRICE_ITEM') {
        const p = await tx.priceItem.findUniqueOrThrow({ where: { id: edit.priceItemId }, select: { sourceLocator: true } });
        await tx.priceItem.update({
          where: { id: edit.priceItemId },
          data: {
            price: edit.price,
            ...(changes.unit ? { unit: changes.unit[1] as string | null } : {}),
            sourceLocator: withCorrection(p.sourceLocator, mark('MANUAL', changes)),
          },
        });
      }
      // A corrected conversion is stored where the import keeps it: `source_locator.factor` of the component.
      const factorEdit = edit.kind === 'COMPONENT' && edit.factor !== undefined ? edit.factor : undefined;
      const withFactor = (locator: unknown) => {
        const rest: Record<string, unknown> = { ...((locator ?? {}) as Record<string, unknown>) };
        delete rest.factor;
        return factorEdit ? { ...rest, factor: factorEdit } : rest;
      };
      if (factorEdit !== undefined && !result.components.has(directComponent!)) {
        const old = pkg.components.get(directComponent!)!;
        await tx.ahspComponent.update({
          where: { id: directComponent! },
          data: { sourceLocator: withCorrection(withFactor(old.sourceLocator), mark('MANUAL', changes)) },
        });
      }
      for (const [id, next] of result.components) {
        const old = pkg.components.get(id)!;
        const diff = changedFields({ coefficient: num(old.coefficient), unitPrice: num(old.unitPrice), amount: num(old.amount) }, next);
        const kind = id === directComponent ? 'MANUAL' : 'RECALCULATED';
        const locator = id === directComponent && factorEdit !== undefined ? withFactor(old.sourceLocator) : old.sourceLocator;
        const marked = id === directComponent && changes.factor ? { ...diff, factor: changes.factor } : diff;
        await tx.ahspComponent.update({ where: { id }, data: { ...next, sourceLocator: withCorrection(locator, mark(kind, marked)) } });
        recalculated.push({ componentId: id, description: old.description, kind, changes: diff });
      }
      for (const [id, next] of result.analyses) {
        const old = pkg.analyses.get(id)!;
        const before = pkg.input.analyses.find((a) => a.id === id)!;
        const diff = changedFields({ ...before }, { ...next });
        const kind = edit.kind === 'ANALYSIS' && edit.analysisVersionId === id ? 'MANUAL' : 'RECALCULATED';
        await tx.ahspAnalysisVersion.update({ where: { id }, data: { ...next, sourceLocator: withCorrection(old.sourceLocator, mark(kind, diff)) } });
        recalculated.push({ analysisVersionId: id, analysis: old.label, kind, changes: diff });
      }
      for (const i of items) {
        const price = newPrice.get(i.analysisVersionId!)!;
        const data = i.priceSource === 'ANALYSIS' ? { unitPrice: price, analysisUnitPrice: price } : { analysisUnitPrice: price };
        const diff = changedFields({ unitPrice: num(i.unitPrice), analysisUnitPrice: num(i.analysisUnitPrice) }, data);
        await tx.rabVersionItem.update({ where: { id: i.id }, data: { ...data, sourceLocator: withCorrection(i.sourceLocator, mark('RECALCULATED', diff)) } });
        recalculated.push({ itemId: i.id, description: i.description, priceSource: i.priceSource, changes: diff });
      }
      await this.rab.correctionAudit(tx, actor, projectId, versionId, reason, {
        action,
        oldValue: { ...target, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])) },
        newValue: { ...target, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])), recalculated },
      });
    });
    return this.rab.get(projectId, versionId);
  }

  /** Relations leaving the package (legacy links) make the impact unknowable: refuse instead of guessing. */
  private async assertIsolated(tx: Db, versionId: string) {
    const isolation = await checkPackageIsolation(tx, versionId);
    const foreignItems = await tx.rabVersionItem.count({
      where: { rabVersionId: { not: versionId }, analysisVersion: { analysis: { rabVersionId: versionId } } },
    });
    const foreignComponents = await tx.ahspComponent.count({
      where: {
        analysisVersion: { analysis: { rabVersionId: { not: versionId } } },
        OR: [
          { priceItem: { priceList: { rabVersionId: versionId } } },
          { subAnalysisVersion: { analysis: { rabVersionId: versionId } } },
        ],
      },
    });
    if (!isIsolated(isolation) || foreignItems || foreignComponents)
      throw new ConflictException('Paket analisa versi ini masih terhubung dengan paket versi lain; koreksi sumber tidak dapat dihitung aman.');
  }

  /**
   * A dependent component is recalculated only when its stored price provably came from its source (price list ×
   * factor, or sub-analysis EXACT/ROUNDED). Otherwise the source formula is unknown and the edit is refused.
   */
  private assertDerivable(pkg: Awaited<ReturnType<RabCorrectionsService['loadPackage']>>, result: ReturnType<typeof recalculatePackage>, direct: string | null) {
    const prices = new Map(pkg.input.prices.map((p) => [p.id, p.price]));
    const analyses = new Map(pkg.input.analyses.map((a) => [a.id, a]));
    for (const id of result.components.keys()) {
      if (id === direct) continue;
      const c = pkg.input.components.find((x) => x.id === id)!;
      const expected = c.priceItemId
        ? applyPriceFactor(prices.get(c.priceItemId)!, c.factor)
        : c.subAnalysisVersionId
          ? applyPriceFactor(
              c.subPriceBasis === 'EXACT'
                ? analyses.get(c.subAnalysisVersionId)!.priceExact
                : analyses.get(c.subAnalysisVersionId)!.price,
              c.factor,
            )
          : null;
      if (expected === null || !new Decimal(expected).toDecimalPlaces(SCALE.unitPrice).equals(c.unitPrice))
        throw new ConflictException(
          `Harga komponen "${pkg.components.get(id)!.description}" (${c.unitPrice}) tidak terbukti berasal dari sumbernya (${expected ?? '–'}); koreksi komponen itu secara manual lebih dahulu.`,
        );
    }
  }

  private async loadPackage(tx: Db, versionId: string) {
    const [prices, versions] = await Promise.all([
      tx.priceItem.findMany({ where: { priceList: { rabVersionId: versionId } }, select: { id: true, price: true } }),
      tx.ahspAnalysisVersion.findMany({
        where: { analysis: { rabVersionId: versionId } },
        include: { components: true },
      }),
    ]);
    const components = new Map(versions.flatMap((v) => v.components.map((c) => [c.id, c] as const)));
    return {
      components,
      analyses: new Map(versions.map((v) => [v.id, { label: v.code ?? v.name, sourceLocator: v.sourceLocator }])),
      input: {
        prices: prices.map((p) => ({ id: p.id, price: num(p.price)! })),
        analyses: versions.map((v) => ({
          id: v.id,
          overheadPercent: num(v.overheadPercent),
          roundingScale: v.roundingScale,
          directCost: num(v.directCost)!,
          overheadAmount: num(v.overheadAmount)!,
          priceExact: num(v.priceExact)!,
          price: num(v.price)!,
        })),
        components: [...components.values()].map((c) => ({
          id: c.id,
          analysisVersionId: c.analysisVersionId,
          coefficient: num(c.coefficient)!,
          unitPrice: num(c.unitPrice)!,
          amount: num(c.amount)!,
          priceItemId: c.priceItemId,
          factor: factorOf(c.sourceLocator),
          subAnalysisVersionId: c.subAnalysisVersionId,
          subPriceBasis: c.subPriceBasis,
        })),
      },
    };
  }
}

/** The constant the source applied to a list price (`source_locator.factor`, D-063). */
function factorOf(locator: unknown): PriceFactor | null {
  const f = (locator as { factor?: { op?: unknown; value?: unknown } } | null)?.factor;
  return f && (f.op === '*' || f.op === '/') && typeof f.value === 'string' ? { op: f.op, value: f.value } : null;
}
