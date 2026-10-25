# apps/api

NestJS backend (REST, prefix `/api`, port default `3001` via `PORT`). Konfigurasi dibaca dari `.env` root.

Semua security/business authorization diverifikasi di backend:

- `CsrfGuard` (global): POST/PUT/PATCH/DELETE wajib `Origin` = `APP_URL`
- `SessionGuard` (global, kecuali `@Public()`): session + user dibaca dari database setiap request
- `@SystemAdminOnly()`: route `/api/admin/*`
- `@RequireProjectPermission(...)`: membership aktif + matriks izin (`docs/PERMISSIONS.md`), tanpa bypass system admin

Struktur:

- `src/auth` — login, logout, me, ganti password, guard, scrypt, rate limit
- `src/admin` — user management dan anggota proyek (system admin)
- `src/projects` — data proyek untuk anggota
- `src/audit` — penulisan audit log (tanpa secret)
- `src/db` — seed (`seed.ts` production-safe, `seed-dev.ts` data contoh, `seed-sample.ts` + `sample-rab.ts` proyek & RAB contoh dari workbook kantor via exceljs), `drop-schema.ts`
- `src/generated/prisma` — hasil `prisma generate` (tidak masuk Git)

Test (Vitest + `unplugin-swc`) memakai MySQL sungguhan pada database `<db>_test`: `npm test -w @laporan-proyek/api`.
