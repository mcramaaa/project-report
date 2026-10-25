# Decisions Log

Dokumen ini merangkum keputusan yang sudah dikunci selama perancangan.

## D-001 Package Manager

**Keputusan:** npm.

- gunakan npm workspaces
- `package-lock.json` masuk Git
- jangan gunakan pnpm/yarn

## D-002 Repository Docs

Wajib ada:

- `/AGENTS.md`
- `/docs/PRD.md`

## D-003 Monorepo

```text
apps/web
apps/api
packages/calc
packages/shared
packages/config
```

## D-004 Frontend

Next.js + TypeScript + Tailwind.

## D-005 Backend

NestJS + TypeScript + REST API.

## D-006 Database

MySQL + Prisma.

Gunakan DECIMAL untuk nilai kritis.

## D-007 Baseline Versioning

Kontrak, MC0, Addendum adalah versioned data. Tidak overwrite.

## D-008 Progress Persistence

Progress aktual terikat ke work item permanen, bukan ke satu versi RAB.

## D-009 Project Weeks

Minggu = blok 7 hari sejak tanggal mulai proyek, bukan kalender Senin-Minggu.

## D-010 Periodic "Monthly" Report

Laporan bulanan kantor = blok 4 minggu / 28 hari sejak tanggal mulai.

Bukan bulan kalender.

## D-011 Daily Factor

Faktor default berdasarkan posisi Hari 1-Hari 7 pada minggu proyek.

Bukan melekat secara kaku ke nama Senin-Minggu.

## D-012 AI Role

AI hanya ekstraktor/assistant.

Data AI selalu:

```text
draft -> validation -> human review -> approval
```

## D-013 AI Connectivity

9router hanya dipanggil dari `apps/api`.

Default base URL:

```text
http://localhost:20128/v1
```

Tidak boleh dipanggil langsung browser.

## D-014 Final Reports

Laporan final dibuat snapshot immutable.

## D-015 File Storage

File asli disimpan di filesystem/storage; database menyimpan metadata/path/hash.

## D-016 External Access

Cloudflare Tunnel setelah aplikasi lokal stabil.

## D-017 Excel Output

Excel adalah output dari database/snapshot. Jangan memakai external workbook links sebagai mekanisme internal.

## D-018 Input Progress

UI mendukung:

- volume minggu
- percent cumulative

Fakta utama database tetap `actual_volume`.

## D-019 Daily Resource

Material/alat dapat memiliki:

- calculated quantity
- actual quantity

Tenaga kerja fase awal manual.

## D-020 Addendum Effective Date

Default: minggu berikutnya.

Tetap dukung exact date untuk kasus resmi.

## D-021 No Coding Before Specs

Sebelum implementasi besar, PRD, ERD, UI flow, dan acceptance tests harus tetap sinkron.

## D-022 Decimal Library

**Keputusan:** `decimal.js`, di-re-export sebagai `Decimal` dari `@laporan-proyek/calc`.

Alasan:

- arbitrary precision dengan rounding mode eksplisit (`toDecimalPlaces(dp, rounding)`), dibutuhkan untuk alokasi harian dan bobot
- tanpa dependency, murni JS, berjalan sama di Node, browser, dan Next.js
- implementasi yang sama dengan `Prisma.Decimal`, sehingga konversi di `apps/api` cukup lewat string (`new Decimal(prismaValue.toString())`) tanpa membuat `packages/calc` bergantung pada Prisma
- big.js lebih kecil, tetapi rounding mode dan operasi yang tersedia lebih terbatas

Aturan:

- `packages/calc` tidak meng-import Prisma/database; penjaga: ESLint `no-restricted-imports`/`no-restricted-globals` dan `types: []` di tsconfig
- presisi/rounding default belum dikonfigurasi; ditetapkan bersama OD-004
- decimal dikirim sebagai string di API (lihat `docs/API.md`)

## D-023 Test Runner

**Keputusan:** Vitest untuk semua workspace.

Alasan:

- satu runner untuk `packages/*`, `apps/api`, dan `apps/web`
- TypeScript dan ESM native tanpa ts-jest
- NestJS mendokumentasikan Vitest + `unplugin-swc` (SWC menghasilkan decorator metadata yang dibutuhkan DI; esbuild tidak)
- jalan per workspace lewat `npm test --workspaces`

`apps/web` belum memiliki test; script `test` ditambahkan saat test pertama dibuat.

## D-024 Tooling Versions

- TypeScript `~6.0`: typescript-eslint 8.x baru mendukung `<6.1`, jadi TypeScript 7 belum dipakai
- ESLint 9 (flat config): plugin di `eslint-config-next` belum mendukung ESLint 10
- Next.js 16 tidak memiliki `next lint`; web memakai `eslint .` dengan `eslint-config-next`
- NestJS 12 memakai CommonJS; `packages/*` memakai ESM dan di-load via `require(esm)` dari Node 24
- `overrides.multer = 2.5.0`: `@nestjs/platform-express@12.2.0` mem-pin multer 2.4.0 yang terkena GHSA-q7qp-rjg7-q26m; hapus override saat Nest merilis versi dengan multer yang sudah diperbaiki

## D-025 Workspace Package Build

`packages/shared` dan `packages/calc` dikompilasi ke `dist/` dan dikonsumsi apps dari sana.

- urutan `workspaces` di root: `packages/*` sebelum `apps/*`, sehingga `npm run build` membangun package lebih dulu
- `predev`, `pretypecheck`, `pretest` di root menjalankan `npm run build:packages`
- menjalankan script satu workspace app secara langsung butuh `npm run build:packages` terlebih dahulu

## D-026 Dua Lapis Administrasi

Disetujui 2026-10-25 (menutup OD-002).

- `users.is_system_admin`: administrasi global, pengelolaan user, pembuatan proyek, pengelolaan anggota/role proyek
- `project_users.role` (FILLER, REVIEWER, MANAGER, ADMIN): akses per proyek
- system admin **tidak** otomatis membaca/mengubah data proyek; tidak ada bypass universal
- endpoint pengelolaan anggota hanya mengembalikan metadata minimum (id, kode, nama proyek; id, nama, email, status user; role)
- pembuat proyek otomatis mendapat role MANAGER dalam transaksi yang sama (diimplementasikan di Milestone 3)
- satu user dapat memiliki role berbeda di proyek berbeda
- role bukan level berurutan; izin ditentukan matriks eksplisit (`docs/PERMISSIONS.md`)

## D-027 UUID untuk ID Publik

Semua primary key memakai UUID v7 (`CHAR(36)`, dibuat Prisma). UUID tidak menggantikan authorization backend.

## D-028 Cakupan Base Schema Milestone 1

Hanya `users`, `auth_sessions`, `projects`, `project_users`, `audit_logs`. Tabel bisnis lain dibuat di milestone masing-masing.

## D-029 Akun User

- tidak ada pendaftaran publik; akun dibuat system admin
- user dinonaktifkan (`is_active = false`), tidak dihapus; histori dan audit tetap ada
- email dinormalisasi `trim` + huruf kecil di backend sebelum disimpan/dicari; keunikan ditegakkan unique index database
- system admin aktif terakhir tidak boleh dinonaktifkan atau dicabut haknya; dicek dalam transaksi dengan `SELECT ... FOR UPDATE` atas semua system admin aktif sehingga aman terhadap request bersamaan
- membership dicabut dengan `revoked_at` (soft revoke). Unique `(project_id, user_id)` tetap berlaku; menambahkan ulang user mengaktifkan kembali baris yang sama

## D-030 Session dan Password

- password: scrypt (`node:crypto`, N=2^15, r=8, p=3, salt 16 byte, sesuai rekomendasi OWASP), format `scrypt$<N>$<r>$<p>$<salt>$<hash>` agar parameter dapat dinaikkan
- kebijakan password: 8–128 karakter (batas atas menjaga biaya hashing)
- token session: 32 byte acak; cookie berisi token, database menyimpan SHA-256 token (`token_hash`). Hash umum boleh untuk token acak berentropi tinggi, tidak untuk password
- masa berlaku session absolut, default 12 jam (`SESSION_TTL_HOURS`)
- setiap request memuat session, user, dan membership dari database; perubahan izin, nonaktivasi, dan pencabutan membership berlaku pada request berikutnya. Role tidak disimpan di cookie/browser
- nonaktivasi user dan perubahan password mencabut semua session user tersebut; setelah ganti password user harus login ulang
- pesan gagal login selalu sama untuk email tidak terdaftar, password salah, atau user nonaktif. Verifikasi password tetap dijalankan untuk email tidak terdaftar agar waktu respons serupa
- pembatasan percobaan login: 5 gagal per email dan 20 gagal per IP dalam 15 menit (in-memory, satu proses)

## D-031 Cookie dan CSRF

- browser hanya berbicara dengan `apps/web`; Next.js me-rewrite `/api/*` ke `apps/api`, sehingga cookie bersifat first-party dan tidak perlu CORS
- cookie `lp_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` otomatis bila `APP_URL` memakai `https`, sehingga localhost http tetap bisa dipakai
- request yang mengubah data (POST/PUT/PATCH/DELETE) wajib membawa header `Origin` yang sama dengan origin `APP_URL`; selain itu ditolak 403. Ini berlaku juga untuk login (login CSRF)

## D-032 Validasi Kontrak API

Zod di `packages/shared` untuk schema input yang dipakai bersama `apps/web` dan `apps/api`. Backend tetap memvalidasi setiap request.

## D-033 Route Administrasi

Endpoint khusus system admin berada di bawah `/api/admin/*`; endpoint data proyek berada di bawah `/api/projects/*` dan memerlukan membership aktif. Akses proyek tanpa membership aktif dijawab 404 agar keberadaan proyek tidak terungkap; membership yang tidak memiliki izin dijawab 403.

## D-034 Audit Log

- `audit_logs.project_id` dan `audit_logs.user_id` (actor) nullable: audit global tidak memiliki proyek, aksi seed tidak memiliki actor
- `old_value`/`new_value` hanya berisi field yang aman ditampilkan; password, hash password, token, dan secret tidak pernah dicatat
- `action` disimpan sebagai string; daftar resmi ada di `packages/shared` dan `docs/PERMISSIONS.md`
- audit ditulis dalam transaksi yang sama dengan perubahan datanya

## Keputusan Terbuka

Belum diputuskan. Jangan diimplementasikan dengan asumsi. Ajukan beserta rekomendasi dan konsekuensinya sebelum milestone terkait dimulai.

### OD-001 Status ekstraksi AI setelah retry gagal

`docs/AI_EXTRACTION.md` §8 menyebut `NEEDS_MANUAL_REVIEW`; enum `ai_extractions.status` di `docs/DATABASE.md` hanya memiliki `NEEDS_REVIEW`. Apakah keduanya status yang sama atau berbeda?

Diputuskan sebelum: Milestone 5 (tabel AI tidak masuk base schema, D-028).

### OD-002 Lingkup role ADMIN

Sudah diputuskan: lihat D-026.

### OD-003 Baseline baru lebih kecil dari realisasi

PRD §6: "sistem memberi error/warning sesuai kebijakan". Kebijakannya belum ada: error yang memblokir aktivasi, warning yang dapat disetujui dengan catatan, atau bergantung role?

Diputuskan sebelum: Milestone 6 (aktivasi baseline) dan Milestone 9 (validasi progres).

### OD-004 Presisi rounding dan "hari aktif" pada alokasi harian

PRD §15: total harian harus sama dengan volume mingguan; selisih ke "hari aktif terakhir". Belum ditetapkan: jumlah desimal (mis. mengikuti `DECIMAL(18,4)`), rounding mode, dan definisi hari aktif (faktor > 0? hari libur? hari di luar masa proyek pada minggu terakhir?).

Diputuskan sebelum: Milestone 10.

### OD-005 Status dan pemilik laporan mingguan & 4 minggu

PRD §24 berlaku untuk semua laporan (DRAFT/REVIEWED/FINAL/REOPENED) dan aturan reviewer-own-entry membutuhkan "siapa yang menginput". `daily_reports` memiliki status/created_by, tetapi laporan mingguan dan periode hanya memiliki `weeks.status`, `report_periods.status`, dan `report_snapshots`. Di mana status, reviewer, dan penginput laporan mingguan/periode disimpan, dan siapa "penginput" laporan mingguan bila progres diisi beberapa user?

Diputuskan sebelum: Milestone 11 (laporan harian) dan Milestone 12/13.

### OD-006 Sumber kebenaran baseline per tanggal

`baseline_assignments` (effective_from/to per proyek) dan `week_baseline_segments` (per minggu) sama-sama menyatakan baseline yang berlaku. Mana yang menjadi sumber kebenaran, dan apakah segment diturunkan dari assignment atau disimpan independen?

Diputuskan sebelum: Milestone 6.

### OD-007 Status proyek dan tanggal selesai rencana

`projects.status` tercantum di `docs/DATABASE.md` tanpa daftar nilai. `planned_finish_date` adalah nilai turunan (start date + durasi) sehingga belum jelas apakah disimpan atau dihitung. Base schema Milestone 1 belum membuat kedua kolom ini.

Diputuskan sebelum: Milestone 3.

### OD-008 Izin role proyek untuk fitur mendatang

Matriks di `docs/PERMISSIONS.md` mengikuti PRD §2. Belum jelas:

- apakah MANAGER juga memiliki fungsi FILLER (PRD hanya menyebut "semua fungsi reviewer")
- siapa "authorized user" selain ADMIN proyek yang boleh approve ekstraksi AI (`docs/ARCHITECTURE.md` §7)
- apakah ADMIN proyek boleh melihat/mengelola anggota proyeknya sendiri (saat ini hanya system admin, D-026)

Diputuskan sebelum: milestone yang pertama kali memakai izin tersebut (Milestone 5, 6, 9, 11).
