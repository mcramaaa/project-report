# prisma

- `schema.prisma` — base schema (D-028); client di-generate ke `apps/api/src/generated/prisma` (tidak masuk Git)
- `migrations/` — jangan edit migration yang sudah diterapkan; buat migration baru
- `../prisma.config.ts` — membaca `.env` root; `DATABASE_URL`, `SHADOW_DATABASE_URL`

Seed ada di `apps/api/src/db/`:

- `seed.ts` — production-safe: system admin pertama dari `SEED_ADMIN_*`, tidak mereset akun yang ada
- `seed-dev.ts` — data contoh development (ditolak bila `NODE_ENV=production`)
