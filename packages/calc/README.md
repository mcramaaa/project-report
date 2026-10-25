# packages/calc

Pure calculation package.

Tidak boleh mengakses database, filesystem, HTTP, AI, atau environment aplikasi.

Target awal:
- daily allocation
- rounding
- cumulative progress
- remaining volume
- weight
- material usage
- deviation

Aritmetika kritis memakai `Decimal` (decimal.js) yang di-re-export dari package ini. Jangan memakai `number` JS untuk perhitungan kritis.

Kemurnian dijaga oleh `eslint.config.js` (import `node:*`/`fs`/`http`/Prisma serta global `process`/`fetch` ditolak).

Test: `npm test -w @laporan-proyek/calc` (Vitest).
