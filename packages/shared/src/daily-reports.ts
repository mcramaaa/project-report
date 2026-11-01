import { z } from 'zod';

/** D-079 laporan harian. */
export const DAILY_REPORT_STATUSES = ['DRAFT', 'FINAL', 'REOPENED'] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];
export const WEATHER_CONDITIONS = ['CLEAR', 'CLOUDY', 'DRIZZLE', 'RAIN', 'OTHER'] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];
export const WEATHER_LABELS: Record<WeatherCondition, string> = { CLEAR: 'Cerah', CLOUDY: 'Berawan', DRIZZLE: 'Gerimis', RAIN: 'Hujan', OTHER: 'Lainnya' };
export const RESOURCE_CATEGORIES = ['LABOR', 'MATERIAL', 'EQUIPMENT'] as const;
export type ResourceCategoryCode = (typeof RESOURCE_CATEGORIES)[number];

const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,18}(\.\d{1,12})?$/, { message: 'Jumlah berupa angka ≥ 0, maks. 12 desimal, gunakan titik untuk desimal.' });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Jam berformat JJ:MM.' });

/** The whole editable part of a draft report; lines replace the previous ones. */
export const saveDailyReportSchema = z.object({
  /** `report.updatedAt` the editor loaded (null for a new report); a newer save by someone else is refused. */
  baseUpdatedAt: z.string().datetime().nullable(),
  note: z.string().trim().max(5000).optional(),
  resources: z
    .array(
      z.object({
        category: z.enum(RESOURCE_CATEGORIES),
        /** AHSP line key for calculated material/equipment; omitted for lines typed by hand. */
        sourceKey: z.string().max(1100).optional(),
        name: z.string().trim().min(1, { message: 'Isi nama.' }).max(500),
        unit: z.string().trim().max(30).optional(),
        actual: quantity.optional(),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .max(2000),
  weather: z
    .array(
      z.object({
        condition: z.enum(WEATHER_CONDITIONS),
        fromTime: time.optional(),
        toTime: time.optional(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .max(24),
});
export type SaveDailyReportInput = z.infer<typeof saveDailyReportSchema>;

export const finalizeDailyReportSchema = z.object({ acknowledgeWarnings: z.boolean().optional() });

export interface DailyReportDayDto {
  date: string;
  /** Hari ke-n of the project week. */
  day: number;
  status: DailyReportStatus | null;
  open: boolean;
}

export interface DailyResourceLineDto {
  /** Stored line id; null for a calculated line not saved yet. */
  id: string | null;
  category: ResourceCategoryCode;
  sourceKey: string | null;
  name: string;
  unit: string | null;
  /** AHSP calculation (live while DRAFT/REOPENED, frozen at FINAL); null for lines typed by hand. */
  calculated: string | null;
  actual: string | null;
  note: string | null;
}

export interface DailyReportDto {
  date: string;
  week: { weekNumber: number; startDate: string; endDate: string; baseline: { rabVersionId: string; label: string } | null };
  day: number;
  /** Null until the first save. */
  report: {
    id: string;
    status: DailyReportStatus;
    createdBy: { id: string; name: string };
    updatedBy: { id: string; name: string };
    updatedAt: string;
    finalizedBy: { id: string; name: string } | null;
    finalizedAt: string | null;
  } | null;
  /** The date has come and the project is ACTIVE. */
  open: boolean;
  note: string | null;
  work: { workItemId: string; workItemCode: string | null; description: string; unit: string | null; volume: string; method: 'DAILY_FACTOR' | 'MANUAL' | 'FINAL'; analysis: string | null }[];
  resources: DailyResourceLineDto[];
  weather: { condition: WeatherCondition; fromTime: string | null; toTime: string | null; note: string | null }[];
  /** Labor names from the project's AHSP labor and earlier reports. */
  laborOptions: string[];
  /** The lines were copied from the previous report (not saved yet). */
  prefilledFrom: string | null;
  issues: { errors: string[]; warnings: string[] };
}
