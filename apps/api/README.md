# apps/api

NestJS backend (REST, prefix `/api`, port default `3001` via `PORT`).

Semua security/business authorization harus diverifikasi di backend.

- `npm run dev -w @laporan-proyek/api` — watch mode (butuh `npm run build:packages` di root lebih dulu)
- `GET /api/health` — health check publik, tanpa detail sensitif
- Test: Vitest + `unplugin-swc` (decorator metadata)
