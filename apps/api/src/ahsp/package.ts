import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';

/**
 * Analysis/price packages owned by one RAB version (D-056, D-057). Every write that puts analyses or prices
 * into a package goes through here, so relations never leave the package: copies from another version's
 * package bring their sub-analyses and prices along and keep `copied_from_id` as provenance.
 */
type Db = Prisma.TransactionClient;

export interface PackageMeta {
  location: string | null;
  period: string | null;
}

/** Price list of the version's package, created on first use. */
export async function ensurePackage(
  tx: Db,
  projectId: string,
  rabVersionId: string,
  actorId: string,
  meta: PackageMeta,
): Promise<string> {
  const existing = await tx.priceList.findUnique({ where: { rabVersionId }, select: { id: true } });
  if (existing) return existing.id;
  const last = await tx.priceList.aggregate({
    where: { projectId },
    _max: { versionNumber: true },
  });
  const id = randomUUID();
  await tx.priceList.create({
    data: {
      id,
      projectId,
      rabVersionId,
      versionNumber: (last._max.versionNumber ?? 0) + 1,
      location: meta.location,
      period: meta.period,
      createdBy: actorId,
    },
  });
  return id;
}

/**
 * Copies analysis versions (and, recursively, their sub-analyses and price items) into the target package.
 * Returns source id → id in the target package. Versions already owned by the target map to themselves;
 * sources copied before into the same package are reused. The source package is never modified.
 */
export async function copyAnalysesIntoPackage(
  tx: Db,
  target: {
    projectId: string;
    rabVersionId: string;
    priceListId: string;
    sourceImportId: string | null;
  },
  sourceVersionIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const sources = new Map<string, SourceVersion>();
  let pending = [...new Set(sourceVersionIds)];
  while (pending.length) {
    const rows = await tx.ahspAnalysisVersion.findMany({
      where: { id: { in: pending } },
      include: SOURCE_INCLUDE,
    });
    if (rows.length !== pending.length)
      throw new Error('Analisa sumber untuk disalin tidak ditemukan.');
    const next: string[] = [];
    for (const v of rows) {
      if (v.analysis.rabVersionId === target.rabVersionId) {
        ids.set(v.id, v.id);
        continue;
      }
      sources.set(v.id, v);
      for (const c of v.components)
        if (
          c.subAnalysisVersionId &&
          !sources.has(c.subAnalysisVersionId) &&
          !ids.has(c.subAnalysisVersionId)
        )
          next.push(c.subAnalysisVersionId);
    }
    pending = [...new Set(next)];
  }
  if (!sources.size) return ids;

  // Idempotent per package: reuse copies made earlier in this package.
  const earlier = await tx.ahspAnalysisVersion.findMany({
    where: {
      copiedFromId: { in: [...sources.keys()] },
      analysis: { rabVersionId: target.rabVersionId },
    },
    select: { id: true, copiedFromId: true },
  });
  for (const e of earlier) {
    ids.set(e.copiedFromId!, e.id);
    sources.delete(e.copiedFromId!);
  }
  if (!sources.size) return ids;
  for (const id of sources.keys()) ids.set(id, randomUUID());

  const priceSources = [
    ...new Set(
      [...sources.values()].flatMap((v) =>
        v.components.flatMap((c) => (c.priceItemId ? [c.priceItemId] : [])),
      ),
    ),
  ];
  const priceIds = new Map<string, string>();
  const ownPrices = await tx.priceItem.findMany({
    where: { id: { in: priceSources }, priceListId: target.priceListId },
    select: { id: true },
  });
  for (const p of ownPrices) priceIds.set(p.id, p.id);
  const earlierPrices = await tx.priceItem.findMany({
    where: { copiedFromId: { in: priceSources }, priceListId: target.priceListId },
    select: { id: true, copiedFromId: true },
  });
  for (const p of earlierPrices) priceIds.set(p.copiedFromId!, p.id);
  const toCopy = await tx.priceItem.findMany({
    where: { id: { in: priceSources.filter((id) => !priceIds.has(id)) } },
  });
  for (const p of toCopy) priceIds.set(p.id, randomUUID());
  if (toCopy.length) {
    await tx.priceItem.createMany({
      data: toCopy.map((p) => ({
        id: priceIds.get(p.id)!,
        priceListId: target.priceListId,
        name: p.name,
        unit: p.unit,
        price: p.price,
        sourceLocator: p.sourceLocator as Prisma.InputJsonValue,
        copiedFromId: p.id,
      })),
    });
  }

  const copies = [...sources.values()];
  const analysisIds = new Map(copies.map((v) => [v.id, randomUUID()]));
  await tx.ahspAnalysis.createMany({
    data: copies.map((v) => ({
      id: analysisIds.get(v.id)!,
      projectId: target.projectId,
      rabVersionId: target.rabVersionId,
      code: v.analysis.code,
      name: v.analysis.name,
      unit: v.analysis.unit,
    })),
  });
  await tx.ahspAnalysisVersion.createMany({
    data: copies.map((v) => ({
      id: ids.get(v.id)!,
      analysisId: analysisIds.get(v.id)!,
      versionNumber: 1,
      priceListId: target.priceListId,
      sourceImportId: target.sourceImportId,
      copiedFromId: v.id,
      code: v.code,
      name: v.name,
      unit: v.unit,
      discipline: v.discipline,
      overheadPercent: v.overheadPercent,
      roundingScale: v.roundingScale,
      directCost: v.directCost,
      overheadAmount: v.overheadAmount,
      priceExact: v.priceExact,
      price: v.price,
      sourceLocator: v.sourceLocator as Prisma.InputJsonValue,
    })),
  });
  await tx.ahspComponent.createMany({
    data: copies.flatMap((v) =>
      v.components.map((c) => ({
        analysisVersionId: ids.get(v.id)!,
        sortOrder: c.sortOrder,
        category: c.category,
        description: c.description,
        unit: c.unit,
        coefficient: c.coefficient,
        priceItemId: c.priceItemId ? priceIds.get(c.priceItemId)! : null,
        subAnalysisVersionId: c.subAnalysisVersionId ? ids.get(c.subAnalysisVersionId)! : null,
        subPriceBasis: c.subPriceBasis,
        unitPrice: c.unitPrice,
        amount: c.amount,
        sourceLocator: c.sourceLocator as Prisma.InputJsonValue,
      })),
    ),
  });
  return ids;
}

const SOURCE_INCLUDE = {
  analysis: { select: { rabVersionId: true, code: true, name: true, unit: true } },
  components: true,
} as const satisfies Prisma.AhspAnalysisVersionInclude;
type SourceVersion = Prisma.AhspAnalysisVersionGetPayload<{ include: typeof SOURCE_INCLUDE }>;

export interface PackageIsolation {
  /** RAB items linking an analysis outside the version's package. */
  items: number;
  /** Analysis versions of the package priced from another package's price list. */
  analysisPriceLists: number;
  /** Components of the package using another package's price item. */
  componentPrices: number;
  /** Components of the package using another package's sub-analysis. */
  subAnalyses: number;
}

/** Counts relations leaving the version's package; all zero means the package is isolated. */
export async function checkPackageIsolation(
  db: Db,
  rabVersionId: string,
): Promise<PackageIsolation> {
  const own = { analysis: { rabVersionId } };
  const [items, analysisPriceLists, componentPrices, subAnalyses] = await Promise.all([
    db.rabVersionItem.count({
      where: {
        rabVersionId,
        analysisVersion: { analysis: { rabVersionId: { not: rabVersionId } } },
      },
    }),
    db.ahspAnalysisVersion.count({
      where: { ...own, priceList: { rabVersionId: { not: rabVersionId } } },
    }),
    db.ahspComponent.count({
      where: {
        analysisVersion: own,
        priceItem: { priceList: { rabVersionId: { not: rabVersionId } } },
      },
    }),
    db.ahspComponent.count({
      where: {
        analysisVersion: own,
        subAnalysisVersion: { analysis: { rabVersionId: { not: rabVersionId } } },
      },
    }),
  ]);
  return { items, analysisPriceLists, componentPrices, subAnalyses };
}

export const isIsolated = (i: PackageIsolation) =>
  i.items + i.analysisPriceLists + i.componentPrices + i.subAnalyses === 0;
