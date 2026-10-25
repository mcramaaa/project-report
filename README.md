# Laporan Proyek

Starter repository dan kumpulan spesifikasi untuk aplikasi laporan progres proyek konstruksi.

## Tujuan

Aplikasi ini menggantikan alur kerja Excel yang tersebar menjadi satu sistem terstruktur:

- Kontrak -> MC-0 -> Addendum sebagai versi baseline.
- Progress aktual tetap utuh walaupun baseline berubah.
- Input progres mingguan menghasilkan alokasi harian.
- Laporan harian, mingguan, dan periode 4 minggu dibentuk dari satu sumber data.
- RAB/AHSP dapat diekstrak AI dari Excel/PDF, tetapi selalu melalui validasi dan approval manusia.
- Laporan final disimpan sebagai snapshot agar tidak berubah karena data di masa depan.
- Excel, PDF, dan PPTX menjadi output, bukan sumber kebenaran utama.

## Baca Sebelum Coding

Urutan dokumen:

1. `AGENTS.md`
2. `docs/PRD.md`
3. `docs/DECISIONS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DATABASE.md`
6. `docs/API.md`
7. `docs/UI_UX.md`
8. `docs/AI_EXTRACTION.md`
9. `docs/EXCEL_MAPPING.md`
10. `docs/PERMISSIONS.md`
11. `docs/ACCEPTANCE_TESTS.md`
12. `docs/ROADMAP.md`
13. `docs/VIBE_CODING_GUIDE.md`

## Stack yang Diputuskan

- Monorepo: npm workspaces
- Frontend: Next.js + TypeScript + Tailwind
- Backend: NestJS + TypeScript + REST API
- Database: MySQL
- ORM: Prisma
- Kalkulasi: package terpisah `packages/calc`
- AI: melalui 9router dari backend saja
- Akses luar: Cloudflare Tunnel setelah aplikasi lokal stabil

## Folder

```text
apps/web
apps/api
packages/calc
packages/shared
packages/config
prisma
storage
docs
```

## Menjalankan Lokal

Butuh Node 24 dan Docker.

```bash
npm install
cp .env.example .env          # isi password/secret sendiri; .env tidak masuk Git
docker compose up -d --wait   # MySQL 8.4 + database _test dan _shadow
npm run db:migrate            # terapkan migration
npm run db:seed               # buat system admin pertama dari SEED_ADMIN_* (.env)
npm run db:seed:dev           # opsional, development saja: proyek contoh DEV-001
npm run dev                   # api :3001 dan web :3000 bersamaan
```

- Web: http://localhost:3000
- API: http://localhost:3001/api/health

### Seed system admin

1. Isi `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD` di `.env` (password minimal 8 karakter; jangan commit).
2. Jalankan `npm run db:seed`.

Seed hanya membuat akun bila email belum ada. Akun yang sudah ada tidak diubah, termasuk password-nya, sehingga aman dijalankan ulang. Password tidak pernah dicetak ke log. Setelah login pertama, ganti password lewat halaman Profil.

### Mencoba alur user & role

| URL | Siapa | Fungsi |
|---|---|---|
| http://localhost:3000/login | semua | login |
| http://localhost:3000/ | user login | proyek dengan membership aktif |
| http://localhost:3000/profile | user login | ganti password (login ulang setelahnya) |
| http://localhost:3000/admin/users | system admin | buat, cari, ubah, aktif/nonaktif user, beri/cabut system admin |
| http://localhost:3000/admin/projects | system admin | pilih proyek → kelola anggota & role |

Langkah singkat:

1. `npm run db:seed` lalu `npm run db:seed:dev` (proyek contoh DEV-001).
2. Login sebagai system admin dari `SEED_ADMIN_EMAIL`.
3. Buat user di Admin: User.
4. Tambahkan user itu ke DEV-001 di Admin: Anggota Proyek dengan role tertentu.
5. Login sebagai user tersebut: proyek DEV-001 tampil di Proyek Saya.

System admin tidak otomatis melihat data proyek; tambahkan dirinya sebagai anggota bila perlu. Izin lengkap: `docs/PERMISSIONS.md`.

### Volume MySQL lama

Skrip `docker/mysql/init/01-databases.sh` (membuat `<db>_test` dan `<db>_shadow`) hanya otomatis jalan saat volume baru dibuat. Untuk volume yang sudah ada, jalankan sekali:

```bash
docker compose exec mysql sh /docker-entrypoint-initdb.d/01-databases.sh
```

Password MySQL di `.env` juga hanya berlaku saat volume pertama kali dibuat.

### Pemeriksaan

```bash
npm run lint
npm run typecheck
npm test        # butuh MySQL berjalan; memakai database <db>_test yang dikosongkan per test
npm run build
```

`typecheck`, `test`, dan `dev` menjalankan `prisma generate` dan membangun `packages/shared` + `packages/calc` lebih dulu (D-025). Test menolak berjalan bila nama database tidak berakhiran `_test`.

### Migration baru

```bash
npm run db:migrate:dev -- --name <nama>   # butuh SHADOW_DATABASE_URL
```

Jangan mengedit migration yang sudah diterapkan.

## Status

Milestone 0 (tooling), Milestone 1 (MySQL + Prisma, base schema, seed), dan Milestone 2 (login/session, user management, role proyek, audit) selesai. Belum ada fitur bisnis proyek (RAB, progres, laporan). Keputusan yang masih terbuka tercatat di `docs/DECISIONS.md` bagian "Keputusan Terbuka".
