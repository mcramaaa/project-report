import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@laporan-proyek/calc';
import type { AhspAnalysisDetailDto, AhspAnalysisSummaryDto, PriceListDto } from '@laporan-proyek/shared';
import { PrismaService } from '../prisma/prisma.service';

const num = (v: { toString(): string } | null) => (v === null ? null : new Decimal(v.toString()).toFixed());

/** One combined analysis list per project (D-045); sources and versions stay traceable. */
@Injectable()
export class AhspService {
  constructor(private readonly prisma: PrismaService) {}

  async list(projectId: string, search?: string): Promise<AhspAnalysisSummaryDto[]> {
    const analyses = await this.prisma.ahspAnalysis.findMany({
      where: {
        projectId,
        ...(search ? { OR: [{ code: { contains: search } }, { name: { contains: search } }] } : {}),
      },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          include: {
            sourceImport: { select: { id: true, targetVersionType: true, documents: { select: { document: { select: { originalFilename: true } } } } } },
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
            source: { importId: v.sourceImport.id, versionType: v.sourceImport.targetVersionType, documents: v.sourceImport.documents.map((d) => d.document.originalFilename) },
          },
        },
      ];
    });
  }

  async get(projectId: string, analysisId: string): Promise<AhspAnalysisDetailDto> {
    const a = await this.prisma.ahspAnalysis.findFirst({
      where: { id: analysisId, projectId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          include: {
            priceList: { select: { id: true, versionNumber: true, location: true, period: true } },
            components: {
              orderBy: { sortOrder: 'asc' },
              include: {
                priceItem: { select: { id: true, name: true, price: true } },
                subAnalysisVersion: { select: { id: true, analysisId: true, code: true, name: true } },
              },
            },
            rabItems: {
              select: { id: true, description: true, displayNumber: true, rabVersion: { select: { id: true, versionType: true, revisionNumber: true, status: true } } },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });
    if (!a) throw new NotFoundException('Analisa tidak ditemukan.');
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      unit: a.unit,
      versions: a.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        code: v.code,
        name: v.name,
        unit: v.unit,
        discipline: v.discipline,
        overheadPercent: num(v.overheadPercent),
        roundingScale: v.roundingScale,
        directCost: num(v.directCost)!,
        overheadAmount: num(v.overheadAmount)!,
        priceExact: num(v.priceExact)!,
        price: num(v.price)!,
        priceList: v.priceList,
        sourceLocator: v.sourceLocator,
        createdAt: v.createdAt.toISOString(),
        components: v.components.map((c) => ({
          id: c.id,
          category: c.category,
          description: c.description,
          unit: c.unit,
          coefficient: num(c.coefficient)!,
          unitPrice: num(c.unitPrice)!,
          amount: num(c.amount)!,
          priceItem: c.priceItem ? { id: c.priceItem.id, name: c.priceItem.name, price: num(c.priceItem.price)! } : null,
          subAnalysis: c.subAnalysisVersion
            ? { analysisId: c.subAnalysisVersion.analysisId, versionId: c.subAnalysisVersion.id, code: c.subAnalysisVersion.code, name: c.subAnalysisVersion.name, basis: c.subPriceBasis }
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

  async priceLists(projectId: string): Promise<PriceListDto[]> {
    const lists = await this.prisma.priceList.findMany({
      where: { projectId },
      include: { items: { orderBy: { name: 'asc' } }, sourceImport: { select: { id: true } } },
      orderBy: { versionNumber: 'desc' },
    });
    return lists.map((l) => ({
      id: l.id,
      versionNumber: l.versionNumber,
      location: l.location,
      period: l.period,
      createdAt: l.createdAt.toISOString(),
      sourceImportId: l.sourceImport?.id ?? null,
      items: l.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, price: num(i.price)!, sourceLocator: i.sourceLocator })),
    }));
  }
}
