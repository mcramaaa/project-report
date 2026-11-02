/**
 * Indonesian number as typed ("4.757,22", "4757,22", "10.5") to the API's dot form ("4757.22", "10.5").
 * With a comma, dots are thousands separators; without one, a dot is the decimal point.
 */
export function parseIdNumber(v: string): string {
  const t = v.trim();
  return t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
}
