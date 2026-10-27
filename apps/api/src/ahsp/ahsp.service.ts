import { Injectable, NotFoundException } from '@nestjs/common';
import { analysisCategoryTotals, Decimal } from '@laporan-proyek/calc';
import {
  rabVersionLabel,
  type AhspCategory,
  type AhspAnalysisDetailDto,
  type AhspAnalysisSummaryDto,
  type PackageOwnerDto,
  type PriceListDto,
} from '@laporan-proyek/shared';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const num = (v: { toString(): string } | null) =>
  v === null ? null : new Decimal(v.toString()).toFixed();

const OWNER_SELECT = {
  id: true,
  versionType: true,
  revisionNumber: true,
  status: true,
} as const satisfies Prisma.RabVersionSelect;
const owner = (
  v: Prisma.RabVersionGetPayload<{ select: typeof OWNER_SELECT }>,
): PackageOwnerDto => ({ ...v, label: rabVersionLabel(v) });
const COPIED_FROM = {
  select: { id: true, analysisId: true, analysis: { select: { rabVersion: { select: OWNER_SELECT } } } },
} as const;
const copiedFrom = (
  c: {
    id: string;
    analysisId: string;
    analysis: { rabVersion: Prisma.RabVersionGetPayload<{ select: typeof OWNER_SELECT }> };
  } | null,
) => (c ? { analysisId: c.analysisId, analysisVersionId: c.id, rabVersion: owner(c.analysis.rabVersion) } : null);

/** One combined analysis list per RAB version's package (D-056); sources and copies stay traceable. */
@Injectable()
export class AhspService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    projectId: string,
    versionId: string,
    search?: string,
  ): Promise<AhspAnalysisSummaryDto[]> {
    await this.version(projectId, versionId);
    const analyses = await this.prisma.ahspAnalysis.findMany({
      where: {
        rabVersionId: versionId,
        ...(search ? { OR: [{ code: { contains: search } }, { name: { contains: search } }] } : {}),
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: {
            sourceImport: {
              select: {
                id: true,
                targetVersionType: true,
                targetRevisionNumber: true,
                documents: { select: { document: { select: { originalFilename: true } } } },
              },
            },
            copiedFrom: COPIED_FROM,
            _count: { select: { components: true, rabItems: true, usedAsSub: true } },
          },
        },
        _count: { select: { versions: true } },
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });
    return analyses.flatMap((a) => {
      const v = a.versions[0];
      if (!v) return [];
      return [
        {
          id: a.id,
          code: a.code,
          name: a.name,
          unit: a.unit,
          versionCount: a._count.versions,
          latestVersion: {
            id: v.id,
            versionNumber: v.versionNumber,
            price: num(v.price)!,
            priceExact: num(v.priceExact)!,
            overheadPercent: num(v.overheadPercent),
            roundingScale: v.roundingScale,
            discipline: v.discipline,
            components: v._count.components,
            rabItems: v._count.rabItems,
            usedAsSub: v._count.usedAsSub,
            source: v.sourceImport
              ? {
                  importId: v.sourceImport.id,
                  versionType: v.sourceImport.targetVersionType,
                  label: rabVersionLabel({ versionType: v.sourceImport.targetVersionType, revisionNumber: v.sourceImport.targetRevisionNumber }),
                  documents: v.sourceImport.documents.map((d) => d.document.originalFilename),
                }
              : null,
            copiedFrom: copiedFrom(v.copiedFrom),
          },
        },
      ];
    });
  }

  async get(
    projectId: string,
    versionId: string,
    analysisId: string,
  ): Promise<AhspAnalysisDetailDto> {
    const a = await this.prisma.ahspAnalysis.findFirst({
      where: { id: analysisId, projectId, rabVersionId: versionId },
      include: {
        rabVersion: { select: OWNER_SELECT },
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            priceList: { select: { id: true, versionNumber: true, location: true, period: true } },
            copiedFrom: COPIED_FROM,
            components: {
              orderBy: { sortOrder: 'asc' },
              include: {
                priceItem: { select: { id: true, name: true, price: true } },
                subAnalysisVersion: {
                  select: { id: true, analysisId: true, code: true, name: true },
                },
              },
            },
            rabItems: {
              select: {
                id: true,
                description: true,
                displayNumber: true,
                rabVersion: {
                  select: { id: true, versionType: true, revisionNumber: true, status: true },
                },
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!a) throw new NotFoundException('Analisa tidak ditemukan di paket versi RAB ini.');
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      rabVersion: owner(a.rabVersion),
      versions: a.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        code: v.code,
        name: v.name,
        unit: v.unit,
        discipline: v.discipline,
        overheadPercent: num(v.overheadPercent),
        roundingScale: v.roundingScale,
        categoryTotals: analysisCategoryTotals(
          v.components.map((c) => ({ category: c.category, amount: num(c.amount)! })),
        ),
        directCost: num(v.directCost)!,
        overheadAmount: num(v.overheadAmount)!,
        priceExact: num(v.priceExact)!,
        price: num(v.price)!,
        priceList: v.priceList,
        sourceLocator: v.sourceLocator,
        createdAt: v.createdAt.toISOString(),
        copiedFrom: copiedFrom(v.copiedFrom),
        components: v.components.map((c) => ({
          id: c.id,
          category: c.category,
          description: c.description,
          unit: c.unit,
          coefficient: num(c.coefficient)!,
          unitPrice: num(c.unitPrice)!,
          amount: num(c.amount)!,
          priceItem: c.priceItem
            ? { id: c.priceItem.id, name: c.priceItem.name, price: num(c.priceItem.price)! }
            : null,
          subAnalysis: c.subAnalysisVersion
            ? {
                analysisId: c.subAnalysisVersion.analysisId,
                versionId: c.subAnalysisVersion.id,
                code: c.subAnalysisVersion.code,
                name: c.subAnalysisVersion.name,
                basis: c.subPriceBasis,
              }
            : null,
          sourceLocator: c.sourceLocator,
        })),
        rabItems: v.rabItems.map((i) => ({
          id: i.id,
          description: i.description,
          displayNumber: i.displayNumber,
          rabVersion: i.rabVersion,
        })),
      })),
    };
  }

  /** Wages, materials and equipment priced in the version's package; null when it has none yet. */
  async priceList(
    projectId: string,
    versionId: string,
    search?: string,
    category?: AhspCategory,
  ): Promise<PriceListDto | null> {
    await this.version(projectId, versionId);
    const l = await this.prisma.priceList.findUnique({
      where: { rabVersionId: versionId },
      include: {
        rabVersion: { select: OWNER_SELECT },
        sourceImport: { select: { id: true } },
        items: {
          where: {
            ...(search ? { name: { contains: search } } : {}),
            ...(category
              ? {
                  components: {
                    some: { category, analysisVersion: { analysis: { rabVersionId: versionId } } },
                  },
                }
              : {}),
          },
          orderBy: { name: 'asc' },
          include: {
            components: {
              where: { analysisVersion: { analysis: { rabVersionId: versionId } } },
              select: { category: true },
            },
            copiedFrom: {
              select: { id: true, priceList: { select: { rabVersion: { select: OWNER_SELECT } } } },
            },
          },
        },
      },
    });
    if (!l) return null;
    return {
      id: l.id,
      rabVersion: owner(l.rabVersion),
      versionNumber: l.versionNumber,
      location: l.location,
      period: l.period,
      createdAt: l.createdAt.toISOString(),
      sourceImportId: l.sourceImport?.id ?? null,
      items: l.items.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        price: num(i.price)!,
        categories: [...new Set(i.components.map((c) => c.category))],
        sourceLocator: i.sourceLocator,
        copiedFrom: i.copiedFrom
          ? { priceItemId: i.copiedFrom.id, rabVersion: owner(i.copiedFrom.priceList.rabVersion) }
          : null,
      })),
    };
  }

  private async version(projectId: string, versionId: string): Promise<void> {
    if (
      !(await this.prisma.rabVersion.findFirst({
        where: { id: versionId, projectId },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Versi RAB tidak ditemukan.');
  }
}
