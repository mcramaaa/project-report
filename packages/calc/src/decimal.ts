import { Decimal as DecimalJs } from 'decimal.js';

/**
 * The single Decimal for all critical math (D-022). The decimal.js default of 20 significant digits
 * silently rounds RAB products such as DECIMAL(30,12) × DECIMAL(26,6) (D-043), so every consumer gets
 * this 80-digit, HALF_UP instance instead of the default one.
 */
export const Decimal = DecimalJs.clone({ precision: 80, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;
export type DecimalValue = string | number | Decimal;
