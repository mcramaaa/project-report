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

Disetujui 2026-10-25 (menutup OD-002). **Sebagian digantikan D-035** (super admin kini memiliki akses penuh; role proyek menjadi dinamis; administrasi dapat didelegasikan).

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
- pembatasan percobaan login: 5 gagal per email (dinormalisasi) dalam 15 menit (in-memory, satu proses). Tidak ada limit per IP: di balik rewrite `apps/web`, `X-Forwarded-For` diteruskan apa adanya dari klien sehingga dapat dipalsukan, sedangkan IP socket selalu proxy (limit per IP akan menjadi global). Limit per IP ditambahkan di Milestone 16 saat Cloudflare menyediakan IP klien tepercaya. `auth_sessions.ip_address` saat ini berisi alamat proxy

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

## D-035 Role Dinamis, Super Admin, dan Delegasi (pola olmat-backoffice)

Disetujui 2026-10-25, menggantikan bagian D-026 yang bertentangan.

- **Super admin** = `users.is_system_admin` (akun pertama dari seed `.env`). Memiliki seluruh permission secara implisit, global maupun di semua proyek, tanpa perlu penugasan. Aturan domain tetap berlaku untuknya (mis. reviewer tidak memfinalisasi input sendiri). Proteksi super admin aktif terakhir tetap (D-029).
- **Permission** didefinisikan di kode (`packages/shared`, `PERMISSIONS`) karena backend yang menegakkannya; database hanya menyimpan kode permission per role. Setiap permission memiliki scope `GLOBAL` atau `PROJECT`. Katalog hanya memuat permission yang sudah ditegakkan; permission baru ditambahkan per milestone.
- **Role** adalah data (`roles`): kode, nama, deskripsi, scope (`PROJECT` / `GLOBAL`), aktif, sistem. Permission role harus sesuai scope role. Role nonaktif tidak memberi permission. Role tidak dihapus.
- **Role sistem bawaan**: FILLER, REVIEWER, MANAGER, ADMIN (scope `PROJECT`). Kode, scope, dan status aktif terkunci; nama, deskripsi, dan permission dapat diubah. Default permission: `project.read` (MANAGER juga `project.update`, D-039).
- **Penugasan proyek**: `project_users.role_id` → role scope `PROJECT`, satu role per user per proyek (unique `project_id, user_id` tetap).
- **Penugasan administrasi**: `user_global_roles` → role scope `GLOBAL`, tanpa proyek, boleh lebih dari satu per user. Tidak ada penugasan proyek "semua proyek"; akses ke semua proyek hanya milik super admin.
- **Delegasi** lewat permission global: `users.read`, `users.manage`, `roles.read`, `roles.manage`, `assignments.read`, `assignments.manage`.
- **Batasan anti-eskalasi**:
  - hanya super admin: memberi/mencabut super admin, membuat atau mengubah akun super admin, membuat/mengubah role `GLOBAL` dan permission-nya, memberi/mencabut role administrasi
  - pemegang delegasi tidak boleh menambah, mengubah, atau mencabut akses proyeknya sendiri
  - risiko yang diterima: pemegang `roles.manage` dapat mengubah permission role proyek yang juga ia pegang; semua perubahan diaudit
- Permission dibaca dari database setiap request; perubahan role, permission, atau penugasan berlaku pada request berikutnya.

## D-036 Status Proyek dan Tanggal Selesai Rencana (OD-007)

Disetujui 2026-10-25.

- `projects.status`: `ACTIVE` | `CLOSED`. Proyek baru `ACTIVE`. Tidak ada `ARCHIVED` dan proyek tidak dihapus.
- Transisi `ACTIVE → CLOSED` (tutup) dan `CLOSED → ACTIVE` (buka kembali) wajib alasan dan diaudit (`CLOSE_PROJECT`, `REOPEN_PROJECT`).
- `CLOSED` menolak perubahan identitas dan jadwal (`409`). Membaca data dan, kelak, mengekspor laporan final tetap boleh. Status proyek tidak mengubah status atau snapshot laporan.
- Tanggal selesai rencana inklusif: `tanggal mulai + masa pelaksanaan − 1` (hari mulai adalah hari ke-1). Dihitung oleh fungsi murni `packages/calc` dan tidak disimpan sebagai kolom proyek. Tanggal adalah tanggal kalender (`YYYY-MM-DD`) tanpa timezone.

## D-037 Minggu dan Periode Laporan Proyek

Disetujui 2026-10-25.

- Minggu ke-n: `start + 7(n−1)` sampai `start + 7n − 1`, dipotong pada tanggal selesai. Minggu terakhir boleh kurang dari 7 hari. Jumlah minggu = `ceil(durasi / 7)`.
- Periode ke-k (B.k) = minggu `4k−3` s.d. `4k`, dipotong pada tanggal selesai. Periode terakhir boleh kurang dari 28 hari.
- Perhitungan ada di `packages/calc` (`plannedFinishDate`, `projectWeeks`, `reportPeriods`); API dan database memakai hasil yang sama.
- Disimpan sebagai baris `weeks` dan `report_periods` karena data mingguan, laporan, dan snapshot kelak menunjuk ke barisnya (foreign key) dan batas minggu lama tidak boleh ikut berubah otomatis setelah ada data (lihat D-038). Tanggal mulai/selesai baris disimpan dengan alasan yang sama.
- Tidak disimpan karena mudah dihitung: jumlah hari, nomor minggu pertama/terakhir periode. Keanggotaan minggu dalam periode disimpan sebagai `weeks.report_period_id` (satu minggu tepat satu periode), menggantikan tabel `report_period_weeks`.
- Status laporan minggu/periode belum dibuat; menunggu OD-005.
- Foreign key ke `weeks` dan `report_periods` memakai `RESTRICT`, bukan cascade.

## D-038 Perubahan Tanggal Mulai dan Durasi

Disetujui 2026-10-25.

Milestone 3:

- Selama proyek `ACTIVE` dan belum ada data yang bergantung pada minggu/periode, tanggal mulai dan durasi boleh diubah.
- Wajib alasan dan audit (`CHANGE_PROJECT_SCHEDULE`, nilai lama & baru), dalam transaksi yang sama dengan pembaruan minggu/periode.
- Nomor minggu/periode yang sama mempertahankan ID baris; hanya tanggalnya yang diperbarui. Minggu/periode baru ditambahkan di akhir.
- Baris di akhir yang tidak lagi tercakup dihapus hanya bila tidak memiliki data terkait; foreign key `RESTRICT` menolak penghapusan bila ada data, dan perubahan dibatalkan (`409`).

Batasan untuk milestone berikutnya (belum selesai hanya karena regenerasi aman di M3):

- Tanggal mulai dikunci setelah ada data terkait.
- Perpanjangan durasi tidak otomatis boleh mengubah semua minggu atau periode lama.
- Perubahan batas minggu/periode terakhir yang sudah memiliki data atau laporan final memerlukan kebijakan khusus sebelum diimplementasikan.
- Snapshot final selalu tetap.

Milestone yang pertama kali membuat data bergantung minggu/periode (M6/M9/M11) wajib menambahkan pemeriksaan ini sebelum mengizinkan perubahan jadwal.

## D-039 Permission dan Data Project Master

Disetujui 2026-10-25.

- `projects.create` (GLOBAL): membuat proyek. Pembuat otomatis mendapat membership MANAGER di proyek itu (juga super admin).
- `project.update` (PROJECT): mengubah identitas, jadwal, dan status proyek. Default role sistem MANAGER: `project.read` + `project.update`; role sistem lain: `project.read`. Migration menambahkan `project.update` ke MANAGER yang sudah ada.
- Role MANAGER dapat diubah permission-nya. Bila MANAGER tidak memiliki `project.read` atau `project.update`, pembuatan proyek ditolak (`409`) dengan pesan konfigurasi. Permission role tidak diubah otomatis dan tidak ada bypass.
- Pembuatan proyek, membership MANAGER, minggu/periode, dan audit dalam satu transaksi.
- Nilai kontrak `DECIMAL(20,2)`, di API berupa decimal string (`"1250000000.00"`). Proyek sebelum M3 dapat bernilai null sampai diisi.
- Validasi: tanggal kalender valid, durasi 1–3650 hari, tahun anggaran 2000–2100. Tidak ada aturan urutan tanggal kontrak/SPMK/mulai.
- Tab tim proyek baca-saja: nama dan role, tanpa email, memerlukan `project.read`. Pengelolaan anggota memakai halaman Akses proyek yang sudah ada.
- Daftar proyek (`GET /projects`, `GET /admin/projects`) memakai pencarian dan pagination.

## D-040 Versi RAB Manual (Milestone 4)

Disetujui 2026-10-25 ("sesuai roadmap", mengikuti rekomendasi yang diajukan).

- `rab_versions.version_type`: `CONTRACT` | `MC0` | `ADDENDUM` (dengan `revision_number` 1, 2, …).
- Status: `DRAFT` → `APPROVED`, atau `DRAFT` → `DISCARDED` (alasan wajib). Tidak ada tahap diajukan/ditolak. Versi APPROVED terkunci permanen dan tidak dihapus; DISCARDED tidak dihapus.
- Urutan versi linear per proyek: CONTRACT dahulu; MC0 hanya setelah CONTRACT approved dan sebelum Addendum; ADDENDUM n setelah versi approved terakhir. Hanya satu DRAFT per proyek.
- CONTRACT dibuat kosong. MC0/ADDENDUM dibuat sebagai salinan versi approved terakhir: baris disalin, `work_item_id` terbawa, `previous_version_item_id` menunjuk baris asal.
- Perbandingan (NEW/MODIFIED/REMOVED/UNCHANGED) dihitung dari `work_item_id` baris ITEM, tidak disimpan.
- Aktivasi baseline, tanggal efektif, dan `baseline_assignments` ditunda ke M6. Approved belum berarti berlaku.
- Jenis baris yang disimpan: `SECTION`, `SUBSECTION`, `PARENT_ITEM`, `ITEM`. `SUBTOTAL`/`TOTAL` dihitung untuk tampilan dan export, tidak disimpan. Hanya `ITEM` yang memiliki volume/harga dan dapat dilacak progresnya (`work_item_id`).
- Induk baris harus berada dalam versi yang sama dan bukan `ITEM`; `SECTION` selalu di tingkat teratas.
- No analisa disimpan sebagai teks (`analysis_code`) sampai AHSP (M7).
- Approve memvalidasi: minimal satu ITEM; setiap ITEM punya satuan, volume ≥ 0, harga satuan ≥ 0, PPN 0–100. Peringatan yang wajib dikonfirmasi: total RAB CONTRACT ≠ nilai kontrak proyek, ITEM dengan volume 0.
- Proyek `CLOSED` menolak pembuatan, perubahan, approve, dan discard versi RAB (perluasan D-036).
- Audit: `CREATE_RAB_VERSION`, `UPDATE_RAB_VERSION`, `APPROVE_RAB_VERSION` (total snapshot), `DISCARD_RAB_VERSION`. Perubahan baris draft tidak diaudit per baris; isi versi approved adalah snapshot yang dapat ditelusuri.
- Grid M4: input manual per baris (tambah, ubah, hapus di draft, naik/turun, pindah induk), header dan kolom kunci sticky, kolom dapat dipilih. Paste massal/import Excel ditunda ke M5.

## D-041 Permission RAB

Disetujui 2026-10-25.

| Permission | Untuk | Default role sistem |
|---|---|---|
| `rab.read` | melihat versi, grid, perbandingan | FILLER, REVIEWER, MANAGER, ADMIN |
| `rab.edit` | membuat/mengubah/discard draft | MANAGER, ADMIN |
| `rab.approve` | approve draft | MANAGER |

Penyetuju boleh sama dengan pembuat draft (tidak ada maker-checker); pembuat dan penyetuju tercatat. Migration menambahkan default ke role sistem yang sudah ada.

## D-042 Rumus RAB (sementara)

Disetujui 2026-10-25 sebagai **rumus sementara**, diturunkan dari spesifikasi (UI_UX §9 kolom harga/PPN/harga+PPN/subtotal/bobot; `tax_percent` per item). Wajib diverifikasi dengan workbook kantor (OD-009) sebelum dipakai untuk data resmi.

- Harga + PPN = ROUND(harga satuan × (1 + PPN% / 100), 2).
- Jumlah (subtotal) = ROUND(volume × harga + PPN, 2).
- Jumlah sebelum PPN per item = ROUND(volume × harga satuan, 2); total sebelum PPN = Σ; total nilai = Σ jumlah; total PPN = total nilai − total sebelum PPN.
- Pembulatan HALF_UP. Total tidak dibulatkan ke ribuan.
- Bobot = jumlah / total nilai × 100, 6 desimal HALF_UP; selisih pembulatan ditambahkan ke ITEM dengan jumlah terbesar (urutan pertama bila sama) agar total tepat 100. Total nilai 0 → bobot 0.
- Semua dihitung dengan Decimal di `packages/calc`. Draft dihitung saat dibaca; saat approve, nilai per baris dan total disimpan sebagai snapshot.
- Format RAB antarproyek berbeda tetapi isinya sama (keterangan user): variasi format ditangani di tampilan, export (M14), dan import (M5), bukan dengan rumus per proyek.

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

Sudah diputuskan: lihat D-036, D-037, D-038.

### OD-008 Izin role proyek untuk fitur mendatang

Matriks di `docs/PERMISSIONS.md` mengikuti PRD §2. Belum jelas:

- apakah MANAGER juga memiliki fungsi FILLER (PRD hanya menyebut "semua fungsi reviewer")
- siapa "authorized user" selain ADMIN proyek yang boleh approve ekstraksi AI (`docs/ARCHITECTURE.md` §7)
- default permission role sistem untuk fitur mendatang (role dinamis D-035 membuat matriks dapat diubah, tetapi default awal per milestone tetap perlu dikonfirmasi)

Diputuskan sebelum: milestone yang pertama kali memakai izin tersebut (Milestone 5, 6, 9, 11).

### OD-009 Verifikasi rumus RAB terhadap workbook kantor

D-042 adalah rumus sementara dari spesifikasi. Perlu dicocokkan dengan contoh workbook: letak PPN (per item/total), tarif, pembulatan per baris dan total (mis. dibulatkan ke ribuan), dan dasar bobot (sebelum/sesudah PPN).

Diputuskan sebelum: RAB resmi pertama di-approve untuk proyek nyata; paling lambat Milestone 5 (import).
