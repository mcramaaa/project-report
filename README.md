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

| URL | Fungsi |
|---|---|
| http://localhost:3000/login | login |
| http://localhost:3000/ | proyek yang dapat dibuka, cari & pagination (super admin: semua); tombol **Proyek baru** |
| http://localhost:3000/projects/new | wizard proyek: identitas → kontrak → SPMK, dengan pratinjau tanggal selesai/minggu/periode |
| http://localhost:3000/projects/:id | tab Informasi (ubah identitas, ubah jadwal, tutup/buka kembali), Minggu & Periode, Tim |
| http://localhost:3000/profile | ganti password (login ulang setelahnya) |
| http://localhost:3000/admin/users | Pengguna: buat, cari, ubah, aktif/nonaktif; tombol **Akses** per user |
| http://localhost:3000/admin/users/:id | role administrasi + proyek yang dapat diakses user |
| http://localhost:3000/admin/roles | Role & permission: role proyek dan role administrasi |
| http://localhost:3000/admin/projects | Akses proyek: anggota & role per proyek |

Langkah singkat:

1. `npm run db:seed` (super admin dari `SEED_ADMIN_*` + 4 role sistem) lalu `npm run db:seed:dev` (proyek contoh DEV-001).
2. Login sebagai super admin.
3. Pengguna → Tambah user.
4. Klik **Akses** pada user tersebut → Tambah akses proyek (DEV-001, role misalnya Filler).
5. Opsional: Role & permission → buat role administrasi (cakupan Global), pilih permission, lalu berikan ke user dari halaman Akses untuk mendelegasikan pengelolaan.
6. Login sebagai user tersebut: hanya proyek dan menu sesuai permission yang tampil.

Model lengkap: `docs/PERMISSIONS.md`.

### Mencoba Project Master (Milestone 3)

1. Login sebagai super admin (atau user dengan role administrasi yang memiliki `projects.create`).
2. **Proyek baru** → isi 3 langkah → Simpan. Anda otomatis menjadi MANAGER proyek tersebut.
3. Tab **Minggu & Periode**: minggu 7 hari sejak tanggal mulai, dikelompokkan per periode B.n; minggu/periode terakhir yang pendek ditandai.
4. **Ubah jadwal** (alasan wajib): minggu/periode dibentuk ulang; riwayat ada di `audit_logs` (`CHANGE_PROJECT_SCHEDULE`).
5. **Tutup proyek** (alasan wajib): identitas/jadwal terkunci, data tetap terbaca; **Buka kembali** membuka kuncinya.
6. Tab **Tim**: nama dan role anggota; kelola anggota lewat Manajemen akses → Akses proyek.

Proyek yang sudah ada sebelum M3 mendapat minggu/periode dari migration `20261025090000_project_master`; nilai kontraknya kosong sampai diisi lewat **Ubah identitas**.

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

Milestone 0 (tooling), Milestone 1 (MySQL + Prisma, base schema, seed), Milestone 2 (login/session, user management, role & permission dinamis, akses proyek, audit), dan Milestone 3 (Project Master: proyek, status, jadwal, minggu & periode 4 minggu, tim) selesai. Belum ada RAB, progres, atau laporan. Keputusan yang masih terbuka tercatat di `docs/DECISIONS.md` bagian "Keputusan Terbuka".
