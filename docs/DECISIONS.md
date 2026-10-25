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

## Keputusan Terbuka

Belum diputuskan. Jangan diimplementasikan dengan asumsi. Ajukan beserta rekomendasi dan konsekuensinya sebelum milestone terkait dimulai.

### OD-001 Status ekstraksi AI setelah retry gagal

`docs/AI_EXTRACTION.md` §8 menyebut `NEEDS_MANUAL_REVIEW`; enum `ai_extractions.status` di `docs/DATABASE.md` hanya memiliki `NEEDS_REVIEW`. Apakah keduanya status yang sama atau berbeda?

Diputuskan sebelum: enum `ai_extractions` dibuat (Milestone 1 bila masuk base schema, paling lambat Milestone 5).

### OD-002 Lingkup role ADMIN

PRD §2 mendefinisikan ADMIN (membuat proyek, kelola user, konfigurasi sistem), tetapi `users` tidak memiliki role dan `project_users.role` bersifat per proyek. Apakah ADMIN role global, role per proyek, atau keduanya? Siapa yang dapat membuat proyek pertama?

Diputuskan sebelum: Milestone 1 (schema users/project_users) dan Milestone 2 (authorization guards).

### OD-003 Baseline baru lebih kecil dari realisasi

PRD §6: "sistem memberi error/warning sesuai kebijakan". Kebijakannya belum ada: error yang memblokir aktivasi, warning yang dapat disetujui dengan catatan, atau bergantung role?

Diputuskan sebelum: Milestone 6 (aktivasi baseline) dan Milestone 9 (validasi progres).

### OD-004 Presisi rounding dan "hari aktif" pada alokasi harian

PRD §15: total harian harus sama dengan volume mingguan; selisih ke "hari aktif terakhir". Belum ditetapkan: jumlah desimal (mis. mengikuti `DECIMAL(18,4)`), rounding mode, dan definisi hari aktif (faktor > 0? hari libur? hari di luar masa proyek pada minggu terakhir?).

Diputuskan sebelum: Milestone 10.

### OD-005 Status dan pemilik laporan mingguan & 4 minggu

PRD §24 berlaku untuk semua laporan (DRAFT/REVIEWED/FINAL/REOPENED) dan aturan reviewer-own-entry membutuhkan "siapa yang menginput". `daily_reports` memiliki status/created_by, tetapi laporan mingguan dan periode hanya memiliki `weeks.status`, `report_periods.status`, dan `report_snapshots`. Di mana status, reviewer, dan penginput laporan mingguan/periode disimpan, dan siapa "penginput" laporan mingguan bila progres diisi beberapa user?

Diputuskan sebelum: schema laporan dibuat (Milestone 1 bila masuk base schema, paling lambat Milestone 12/13).

### OD-006 Sumber kebenaran baseline per tanggal

`baseline_assignments` (effective_from/to per proyek) dan `week_baseline_segments` (per minggu) sama-sama menyatakan baseline yang berlaku. Mana yang menjadi sumber kebenaran, dan apakah segment diturunkan dari assignment atau disimpan independen?

Diputuskan sebelum: Milestone 6.
