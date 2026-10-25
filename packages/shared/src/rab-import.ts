import { z } from 'zod';
import { RAB_ROW_TYPES, RAB_VERSION_TYPES } from './rab.js';

/** Structured draft of a RAB package import (D-045–D-053, RAB_IMPORT_GUIDE v1). Decimals are strings. */
export const RAB_IMPORT_STATUSES = ['UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'] as const;
export type RabImportStatus = (typeof RAB_IMPORT_STATUSES)[number];
export const RAB_IMPORT_DECISION_KINDS = ['ANALYSIS_LINK', 'PRICE_CHOICE', 'DIRECT_PRICE', 'WORK_ITEM_MATCH'] as const;
export type RabImportDecisionKind = (typeof RAB_IMPORT_DECISION_KINDS)[number];
export const IMPORT_ISSUE_SEVERITIES = ['BLOCKING', 'WARNING', 'INFO'] as const;
export const AHSP_CATEGORIES = ['LABOR', 'MATERIAL', 'EQUIPMENT'] as const;
export type AhspCategory = (typeof AHSP_CATEGORIES)[number];

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const locatorSchema = z.object({ documentId: z.string(), sheet: z.string(), cell: z.string().optional(), row: z.number().int().optional() });
export type SourceLocator = z.infer<typeof locatorSchema>;

export const evidenceStepSchema = z.object({ cell: z.string(), formula: z.string().nullable(), value: scalar, via: z.enum(['START', 'REF', 'VLOOKUP']) });
export type EvidenceStep = z.infer<typeof evidenceStepSchema>;

export const importIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(IMPORT_ISSUE_SEVERITIES),
  message: z.string(),
  rowKey: z.string().optional(),
  analysisKey: z.string().optional(),
  /** Decisions that resolve this issue. */
  resolvedBy: z.array(z.enum(RAB_IMPORT_DECISION_KINDS)).optional(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const draftPriceSchema = z.object({ key: z.string(), name: z.string(), unit: z.string().nullable(), price: decimal, locator: locatorSchema, evidence: z.array(evidenceStepSchema) });
export type DraftPrice = z.infer<typeof draftPriceSchema>;

export const draftComponentSchema = z.object({
  category: z.enum(AHSP_CATEGORIES),
  description: z.string(),
  unit: z.string().nullable(),
  coefficient: decimal,
  unitPrice: decimal,
  /** Cached workbook amount, for reconciliation. */
  sourceAmount: decimal.nullable(),
  amount: decimal,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('PRICE_ITEM'), priceKey: z.string(), factor: z.object({ op: z.enum(['*', '/']), value: z.string() }).optional() }),
    z.object({ kind: z.literal('ANALYSIS'), analysisKey: z.string(), basis: z.enum(['EXACT', 'ROUNDED']), roundingScale: z.number().int().nullable() }),
    z.object({ kind: z.literal('LITERAL') }),
  ]),
  locator: locatorSchema,
  evidence: z.array(evidenceStepSchema),
});
export type DraftComponent = z.infer<typeof draftComponentSchema>;

export const draftAnalysisSchema = z.object({
  key: z.string(),
  code: z.string().nullable(),
  /** Original analysis name; never replaced by the recap name (D-047). */
  name: z.string(),
  unit: z.string().nullable(),
  discipline: z.string().nullable(),
  locator: locatorSchema,
  overheadPercent: decimal.nullable(),
  /** Rounding the source applies where the analysis price is used (D-051); null = none. */
  roundingScale: z.number().int().nullable(),
  computed: z.object({ directCost: decimal, overheadAmount: decimal, priceExact: decimal, price: decimal }),
  source: z.object({ directCost: decimal.nullable(), priceExact: decimal.nullable() }),
  components: z.array(draftComponentSchema),
  usedByRows: z.array(z.string()),
  usedByAnalyses: z.array(z.string()),
});
export type DraftAnalysis = z.infer<typeof draftAnalysisSchema>;

export const workItemCandidateSchema = z.object({ workItemId: z.string(), code: z.string(), description: z.string(), groupPath: z.string() });
export const analysisCandidateSchema = z.object({
  analysisVersionId: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  unit: z.string().nullable(),
  price: decimal,
  /** How the candidate was found; never applied without a reviewer decision. */
  reason: z.string(),
  origin: z.enum(['RULE', 'AI']),
});
export type AnalysisCandidate = z.infer<typeof analysisCandidateSchema>;

export const draftRowSchema = z.object({
  key: z.string(),
  rowType: z.enum(RAB_ROW_TYPES),
  parentKey: z.string().nullable(),
  displayNumber: z.string().nullable(),
  /** Item name follows the recap/RAB sheet (D-047). */
  description: z.string(),
  groupPath: z.string(),
  locator: locatorSchema,
  volume: decimal.nullable(),
  unit: z.string().nullable(),
  taxPercent: decimal.nullable(),
  analysisCode: z.string().nullable(),
  sourceUnitPrice: decimal.nullable(),
  price: z.object({
    /** ANALYSIS = formula chain proves an analysis; DIRECT = literal price; UNRESOLVED = chain broken/ambiguous. */
    kind: z.enum(['ANALYSIS', 'DIRECT', 'UNRESOLVED', 'NONE']),
    analysisKey: z.string().nullable(),
    roundingScale: z.number().int().nullable(),
    evidence: z.array(evidenceStepSchema),
    /** Lookup key where the chain stopped (e.g. the analysis code in a values-only recap). */
    stoppedAt: z.object({ cell: z.string(), value: scalar, lookupKey: scalar }).nullable(),
  }),
  analysisCandidates: z.array(analysisCandidateSchema),
  workItemCandidates: z.array(workItemCandidateSchema),
});
export type DraftRow = z.infer<typeof draftRowSchema>;

export const rabImportDraftSchema = z.object({
  guideVersion: z.string(),
  parserVersion: z.string(),
  targetVersionType: z.enum(RAB_VERSION_TYPES),
  sources: z.array(z.object({ documentId: z.string(), filename: z.string(), sha256: z.string(), sheet: z.string(), block: z.string().nullable() })),
  rows: z.array(draftRowSchema),
  analyses: z.array(draftAnalysisSchema),
  prices: z.array(draftPriceSchema),
  workbookTotals: z.object({ value: decimal, rounded: decimal.nullable() }).nullable(),
  stats: z.object({
    items: z.number().int(),
    analysesInWorkbook: z.number().int(),
    analysesImported: z.number().int(),
    subAnalyses: z.number().int(),
    components: z.number().int(),
    pricesImported: z.number().int(),
  }),
  issues: z.array(importIssueSchema),
});
export type RabImportDraft = z.infer<typeof rabImportDraftSchema>;

export const createRabImportSchema = z.object({
  targetVersionType: z.enum(RAB_VERSION_TYPES),
  sources: z
    .array(z.object({ documentId: z.uuid(), rabSheet: z.string().trim().min(1).max(120).optional() }))
    .min(1, { message: 'Pilih minimal satu dokumen.' })
    .max(10),
});
export type CreateRabImportInput = z.infer<typeof createRabImportSchema>;

const decisionValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ANALYSIS_LINK'), value: z.union([z.object({ analysisKey: z.string() }), z.object({ analysisVersionId: z.uuid() })]) }),
  z.object({ kind: z.literal('PRICE_CHOICE'), value: z.object({ source: z.enum(['ANALYSIS', 'SOURCE_OVERRIDE']) }) }),
  z.object({ kind: z.literal('DIRECT_PRICE'), value: z.object({ accept: z.literal(true) }) }),
  z.object({ kind: z.literal('WORK_ITEM_MATCH'), value: z.object({ workItemId: z.uuid().nullable() }) }),
]);

export const rabImportDecisionsSchema = z.object({
  decisions: z
    .array(z.intersection(z.object({ rowKey: z.string().min(1).max(100), reason: z.string().trim().max(1000).optional() }), decisionValue))
    .min(1)
    .max(2000),
});
export type RabImportDecisionsInput = z.infer<typeof rabImportDecisionsSchema>;

export interface RabImportSummaryDto {
  id: string;
  targetVersionType: (typeof RAB_VERSION_TYPES)[number];
  status: RabImportStatus;
  attemptNumber: number;
  previousImportId: string | null;
  guideVersion: string;
  documents: { id: string; originalFilename: string }[];
  createdBy: { id: string; name: string };
  createdAt: string;
  processedAt: string | null;
  errorMessage: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  rabVersionId: string | null;
  blockingIssues: number;
}

export interface RabImportDecisionDto {
  id: string;
  rowKey: string;
  kind: RabImportDecisionKind;
  value: unknown;
  reason: string | null;
  decidedBy: { id: string; name: string };
  decidedAt: string;
}

export interface AiRunDto {
  id: string;
  purpose: string;
  instructionVersion: string;
  model: string;
  attempt: number;
  status: 'SUCCEEDED' | 'FAILED';
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface RabImportDetailDto {
  import: RabImportSummaryDto;
  draft: RabImportDraft | null;
  /** Issues after applying the current decisions. */
  issues: ImportIssue[];
  decisions: RabImportDecisionDto[];
  aiRuns: AiRunDto[];
  /** Reconciliation of the version the import would create, D-043 formula. */
  reconciliation: { realCost: string; rounded: string; workbookRealCost: string | null; workbookRounded: string | null; matches: boolean | null } | null;
}

export interface DocumentDto {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  uploadedBy: { id: string; name: string };
  uploadedAt: string;
  /** Sheets that look like a RAB (VOLUME + NO. ANALISA header), for choosing `rabSheet`. */
  rabSheetCandidates: string[];
}
