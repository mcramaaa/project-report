/**
 * D-083: decimals shown for each kind of number (user rule, 2026-11-02). Display only: stored values and every
 * calculation stay exact (decimal-safe), and the exact value stays visible in the "asal nilai" popup.
 */
export const DECIMALS = {
  /** Rupiah amounts and prices. */
  money: 2,
  /** Volumes and material/equipment quantities. */
  volume: 2,
  /** AHSP coefficients. */
  ahsp: 4,
  /** Bobot: % of the project weight (weights, realisasi, rencana, deviasi, schedule cells). */
  weight: 3,
} as const;
