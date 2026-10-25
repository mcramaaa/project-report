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

Untuk pekerjaan impor RAB/AHSP, baca juga [panduan impor tetap](docs/RAB_IMPORT_GUIDE.md).
Panduan memuat konsolidasi analisa, referensi yang dipakai, penelusuran formula
rekap, dan aturan nama pekerjaan. Integrasi ke prompt/validator AI masih harus
diimplementasikan pada pipeline impor.

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
npm run ai:ping               # uji koneksi 9router (data dummy; model utama + fallback; key tidak dicetak)
npm run db:seed:sample        # opsional, development saja: proyek SDN 2 Serangan + RAB Kontrak & MC-0 dari workbook di storage/temp
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

### Mencoba Impor RAB + AHSP (M5/M7)

**Seed contoh lewat alur impor** (development saja, D-053; tidak menyentuh proyek lain):

```bash
npm run db:seed                  # super admin dulu
npm run db:seed:sample-ahsp      # storage/temp/00. RAB PENAWARAN… (Kontrak) dan 04. LAPORAN MINGGUAN… (MC-0)
```

Membuat proyek `SDN2-SERANGAN-2026-AHSP`: upload file asli → draft → keputusan reviewer dicatat eksplisit atas nama super admin (harga langsung SMKK; untuk MC-0 tautan ke analisa resmi Kontrak dan pencocokan pekerjaan) → approve impor → approve RAB (M4). Seed berhenti sebelum approve bila ada issue terbuka, rekonsiliasi analisa gagal, atau total berbeda dari workbook. Aman diulang dan melanjutkan dari langkah yang gagal.

1. Proyek → tab **Impor RAB**: upload .xlsx, centang dokumen, pilih peran (RAB utama/pendukung) dan sheet, **Buat run impor**.
2. Halaman review: rekonsiliasi total, issue, rantai rumus tiap item, kandidat, keputusan; **Approve impor** aktif setelah semua issue BLOCKING diputuskan.
3. Tab **Analisa**: satu daftar analisa gabungan proyek; detail menampilkan komponen, sumber harga, subanalisa, dan item RAB yang merujuk. Kode analisa di grid RAB menautkan ke detailnya.

### Mencoba RAB Manual (Milestone 4)

Rumus mengikuti workbook kantor (D-043): harga + PPN dan jumlah per item tanpa pembulatan, total **REAL COST** (2 desimal) dan **Dibulatkan** (dipotong ke rupiah).

**Seed contoh dari workbook kantor** (development saja, D-044):

```bash
npm run db:seed                # super admin dulu
npm run db:seed:sample         # baca storage/temp/04. LAPORAN MINGGUAN SDN 2 SERANGAN (MC 0).xlsx
npm run db:seed:sample -- --file "/path/lain.xlsx"   # workbook lain dengan format yang sama
```

Membuat proyek `SDN2-SERANGAN-2026` (identitas dari sheet Data, 210 hari, 30 minggu) dengan RAB Kontrak dan MC-0 approved dari sheet `RAB + PPN`; super admin seed menjadi MANAGER dan penyetuju. Seed membandingkan total aplikasi dengan JUMLAH TOTAL/DIBULATKAN workbook dan **membatalkan tanpa menulis apa pun bila berbeda**. Dijalankan ulang tidak mengubah apa-apa. File workbook tetap di `storage/temp/` (tidak masuk Git).

1. Buka proyek → tab **RAB** → **Buat versi** (Kontrak).
2. **Tambah baris teratas** (Bagian), lalu **+ Sub** untuk sub-bagian/induk/item. Item berisi volume, satuan, no analisa, harga satuan, PPN %.
3. Panel **Pemeriksaan draft** menampilkan error (wajib diperbaiki) dan peringatan (wajib dikonfirmasi saat approve).
4. **Approve RAB** (role MANAGER): versi terkunci, nilai disimpan sebagai snapshot.
5. Buat **MC-0** atau **Addendum**: isi disalin dari versi approved terakhir; ubah, tambah, hapus baris; **Bandingkan** menampilkan Baru/Berubah/Dihapus/Tetap per kode pekerjaan (WI-xxxx).

Proyek yang sudah ada sebelum M3 mendapat minggu/periode dari migration `20261025090000_project_master`; nilai kontraknya kosong sampai diisi lewat **Ubah identitas**.

### Menghapus schema

```bash
npm run schema:drop            # minta konfirmasi: ketik nama database
npm run schema:drop -- --yes   # tanpa konfirmasi (untuk skrip)
npm run db:migrate && npm run db:seed
```

Menghapus **semua tabel dan data** (termasuk `_prisma_migrations`) di database `DATABASE_URL`; database `_test`/`_shadow` tidak disentuh kecuali `DATABASE_URL` diarahkan ke sana. Ditolak bila `NODE_ENV=production`. Buat backup dulu bila datanya masih dibutuhkan.

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

Milestone 0 (tooling), Milestone 1 (MySQL + Prisma, base schema, seed), Milestone 2 (login/session, user management, role & permission dinamis, akses proyek, audit), Milestone 3 (Project Master: proyek, status, jadwal, minggu & periode 4 minggu, tim), dan Milestone 4 (RAB manual: versi Kontrak/MC-0/Addendum, hierarki, grid, perbandingan, approval; rumus sesuai workbook kantor D-043, seed contoh SDN 2 Serangan) selesai. Belum ada import/AI, baseline aktif, progres, atau laporan. Keputusan yang masih terbuka tercatat di `docs/DECISIONS.md` bagian "Keputusan Terbuka".
