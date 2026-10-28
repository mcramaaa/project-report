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

(Sejak D-069 berlaku untuk setiap MC; Addendum bukan lagi jenis versi.)

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
- Perbandingan (NEW/MODIFIED/REMOVED/UNCHANGED) dihitung dari `work_item_id` baris ITEM, tidak disimpan. MODIFIED juga mencakup perpindahan ke kelompok lain: identitas kelompok mengikuti rantai salinan ke baris asalnya, jadi ID induk baru hasil salinan bukan perubahan.
- Aktivasi baseline, tanggal efektif, dan `baseline_assignments` ditunda ke M6. Approved belum berarti berlaku.
- Jenis baris yang disimpan: `SECTION`, `SUBSECTION`, `PARENT_ITEM`, `ITEM`. `SUBTOTAL`/`TOTAL` dihitung untuk tampilan dan export, tidak disimpan. Hanya `ITEM` yang memiliki volume/harga dan dapat dilacak progresnya (`work_item_id`).
- Kode work item `WI-0001`, … diurutkan secara numerik (bukan teks), sehingga aman melewati WI-9999.
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

## D-042 Rumus RAB (sementara) — digantikan D-043

Disetujui 2026-10-25 sebagai **rumus sementara**, diturunkan dari spesifikasi (UI_UX §9 kolom harga/PPN/harga+PPN/subtotal/bobot; `tax_percent` per item). Wajib diverifikasi dengan workbook kantor (OD-009) sebelum dipakai untuk data resmi.

- Harga + PPN = ROUND(harga satuan × (1 + PPN% / 100), 2).
- Jumlah (subtotal) = ROUND(volume × harga + PPN, 2).
- Jumlah sebelum PPN per item = ROUND(volume × harga satuan, 2); total sebelum PPN = Σ; total nilai = Σ jumlah; total PPN = total nilai − total sebelum PPN.
- Pembulatan HALF_UP. Total tidak dibulatkan ke ribuan.
- Bobot = jumlah / total nilai × 100, 6 desimal HALF_UP; selisih pembulatan ditambahkan ke ITEM dengan jumlah terbesar (urutan pertama bila sama) agar total tepat 100. Total nilai 0 → bobot 0.
- Semua dihitung dengan Decimal di `packages/calc`. Draft dihitung saat dibaca; saat approve, nilai per baris dan total disimpan sebagai snapshot.
- Format RAB antarproyek berbeda tetapi isinya sama (keterangan user): variasi format ditangani di tampilan, export (M14), dan import (M5), bukan dengan rumus per proyek.

## D-043 Rumus RAB Mengikuti Workbook Kantor (menutup OD-009)

Disetujui 2026-10-25 setelah membaca contoh workbook proyek SDN 2 Serangan (`RAB + PPN`, `REKAP RAB`, laporan mingguan MC-0). Menggantikan D-042.

- Harga + PPN = harga satuan × (1 + PPN% / 100), **tanpa pembulatan**. Workbook: `G + G*H/100`, PPN 11% per item.
- Jumlah = volume × (harga + PPN), **tanpa pembulatan** (`D*I`).
- Jumlah sebelum PPN per item = volume × harga satuan; total sebelum PPN = Σ; total nilai = Σ jumlah; total PPN = total nilai − total sebelum PPN. Semua eksak.
- **REAL COST** = ROUND(total nilai, 2) HALF_UP (`TRUNC(ROUND(SUM(..),2),2)`).
- **DIBULATKAN** = REAL COST dipotong ke rupiah (`TRUNC(..,0)`).
- Bobot = jumlah / total nilai × 100, tanpa pembulatan dan tanpa penyesuaian ke item terbesar; API mengirim 10 desimal, UI menampilkan 4 desimal.
- Presisi penyimpanan agar hasil sama dengan workbook: volume DECIMAL(30,12) (workbook MC-0 memakai volume 13 desimal untuk menyeimbangkan total; 4 desimal menggeser total Rp 9,49), harga satuan DECIMAL(20,2), PPN DECIMAL(5,2), harga + PPN DECIMAL(26,6), jumlah DECIMAL(48,18), total DECIMAL(50,18). Bobot tidak disimpan; dihitung dari snapshot jumlah.
- Peringatan nilai kontrak: muncul bila nilai kontrak proyek tidak sama dengan REAL COST maupun DIBULATKAN.
- Tetap per versi tidak ada rumus per proyek; format berbeda ditangani tampilan/export/import.

## D-044 Library Excel dan Seed Contoh RAB

Disetujui 2026-10-25.

- `exceljs` 4.4.0 (MIT) di `apps/api` untuk membaca workbook. Dipakai seed contoh sekarang dan import Excel (M5). `uuid` di-override ke 11.1.1 (GHSA-w5hq-g745-h8pq pada uuid 8 yang dipakai exceljs; exceljs hanya memakai `v4`).
- `npm run db:seed:sample`: hanya development; membaca workbook dari `storage/temp/` (tidak masuk Git, data proyek nyata tidak di-commit). Membuat proyek contoh SDN 2 Serangan beserta RAB Kontrak dan MC-0 (keduanya approved) dari sheet `RAB + PPN` laporan mingguan MC-0, dengan super admin seed sebagai pembuat/penyetuju. Idempotent: tidak berbuat apa-apa bila kode proyek sudah ada.
- Pemetaan baris workbook: kode `A`…`H` → SECTION; `B.I` dst → SUBSECTION; nomor dengan volume → ITEM; nomor tanpa volume yang diikuti baris tanpa nomor → PARENT_ITEM dengan sub-item; baris tanpa nomor dan tanpa volume → lanjutan uraian baris sebelumnya; baris `JUMLAH`/`JUMLAH TOTAL`/`DIBULATKAN` dilewati (dihitung). Item bervolume 0 di MC-0 tidak disalin ke MC-0 (REMOVED).

## D-045 Upload Paket Lengkap dan Konsolidasi Disiplin

Koreksi scope pada 2026-10-26: penggabungan analisa berlaku per versi RAB,
bukan lintas seluruh proyek; bagian yang bertentangan digantikan D-056.

Kebutuhan pengguna 2026-10-25: dokumen RAB beserta analisa, upah, bahan, dan
alat dapat di-upload seluruhnya, termasuk Struktur/Arsitektur/MEP yang terpisah.

- Satu versi RAB proyek dapat memiliki banyak dokumen/sheet sumber. Hasilnya
  satu RAB terintegrasi dengan kelompok disiplin dan hierarki yang terlacak.
- Pemisahan file bukan pemisahan versi baseline. Kontrak, MC0, dan Addendum
  tetap versi berbeda; file asli tetap disimpan.
- Klarifikasi pengguna: bentuk sumber analisa boleh gabungan lintas disiplin,
  terpisah per disiplin, maupun bercampur dengan RAB di file/sheet yang sama.
  **Di sistem hasilnya selalu satu daftar analisa gabungan untuk proyek**,
  bukan daftar/menu terpisah Struktur/Arsitektur/MEP. Disiplin dan sumber
  menjadi metadata/filter; versi dan identitas analisa tetap dipertahankan.
  Satu analisa yang sudah tervalidasi dapat
  dirujuk beberapa item; jangan menduplikasi komponen hanya karena itemnya
  berada di kelompok disiplin berbeda. Pemetaan disahkan melalui review.
- Setiap baris draft/hasil resmi perlu provenance ke dokumen, sheet/halaman,
  dan baris sumber. Identitas file tidak boleh hilang saat konsolidasi.
- Rincian pekerjaan dihitung sekali; rekap dan subtotal sumber dipakai untuk
  rekonsiliasi, bukan ditambahkan sebagai pekerjaan lagi.
- Kesamaan kode/nama lintas disiplin tidak menjadi aturan auto-merge; konflik
  item, analisa, satuan, koefisien, atau harga memerlukan review manusia.
- M5 mencakup penerimaan paket dan draft terstruktur seluruh jenis data.
  AHSP resmi, komponen dan pengaitannya tetap M7. Detail model database/API,
  matching, scope harga referensi, serta approval data AHSP/harga diselesaikan
  sebelum implementasi terkait (OD-011), bukan diasumsikan dari nomor analisa.
- Semua hasil ekstraksi melewati validasi, review, dan approval sesuai domain;
  perubahan sumber tidak menimpa RAB approved atau baseline lama.

## D-046 Harga dari Analisa dan Impor Referensi Terpakai

Kebutuhan pengguna 2026-10-25:

- Alur harga: harga upah/bahan/alat × koefisien komponen → harga satuan analisa
  → dikalikan volume pekerjaan → nilai item → rekap RAB. PPN mengikuti D-043
  pada nilai yang tepat, tanpa pajak ganda. Semua kalkulasi kritis decimal-safe.
- Pada impor paket, mulai dari item RAB yang dimasukkan ke versi tujuan,
  telusuri analisa yang dirujuk, lalu komponen dan harga yang diperlukan.
  Analisa, bahan, upah, dan alat yang tidak terpakai tidak dibuat sebagai data
  domain. File sumber lengkap tetap disimpan untuk audit/penelusuran.
- Analisa bersama tidak diduplikasi karena dipakai beberapa item. Penentuan
  keterpakaian berdasarkan referensi, bukan sekadar volume > 0. Komponen
  berkoefisien 0 yang tercantum dalam analisa terpilih tidak dibuang otomatis.
- Referensi hilang/ambigu atau selisih hasil hitung dengan harga pada RAB
  masuk validasi/review; jangan mengarang harga/koefisien atau menimpa nilai
  resmi secara diam-diam. Data historis dan RAB approved tetap terlindungi.
- Pengelolaan AHSP dan penurunan harga merupakan dependency impor lengkap.
  Rencana M5/M7 harus menjelaskan urutan penyelesaiannya sebelum mengklaim
  alur end-to-end selesai; penyimpanan draft M5 saja belum memenuhi alur ini.
- Detail overhead/profit, dasar PPN, rounding komponen, serta item tanpa
  analisa memerlukan keputusan OD-012 sebelum kalkulasi resminya dibuat.

## D-047 Pemetaan Formula Rekap dan Panduan Impor Tetap

Kebutuhan pengguna 2026-10-25:

- Nama rekap dapat berbeda dari nama analisa. Telusuri formula dan rantai
  referensinya untuk menentukan analisa yang dirujuk; nama item RAB mengikuti
  rekap. Nama analisa asli tidak ditimpa, dan bukti relasi tetap terlacak.
- Rumus/kandidat yang tidak dapat dibuktikan, eksternal tidak tersedia, atau
  ambigu masuk review manusia. Jangan mengarang pemetaan dari nama saja.
- Cara impor disimpan di `docs/RAB_IMPORT_GUIDE.md` agar pengembang dan AI
  aplikasi mempunyai acuan tetap. Implementasi wajib menghubungkannya ke
  instruksi ekstraksi, structured schema, validator, review, dan test; bukan
  mengandalkan chat atau file yang belum diintegrasikan ke runtime. Versi
  instruksi perlu terlacak pada ekstraksi.
- Panduan mencakup D-045/D-046: satu daftar analisa gabungan, impor referensi
  terpakai, harga dari komponen × koefisien, dan histori versi aman.

## D-048 Status Impor dan Retry (menutup OD-001)

Disetujui 2026-10-25.

- `rab_imports.status`: `UPLOADED → PROCESSING → NEEDS_REVIEW → APPROVED | REJECTED`; `FAILED` untuk kegagalan teknis (file rusak, parser/AI error yang tidak dapat diselesaikan).
- `NEEDS_MANUAL_REVIEW` digabung ke `NEEDS_REVIEW`; masalah tercatat per baris pada draft (`issues`).
- Retry membuat run baru (`attempt_number` + 1, `previous_import_id` ke run sebelumnya). Hasil, draft, dan keputusan review run lama tidak ditimpa atau dipindahkan.
- Run `PROCESSING` yang terputus saat server berhenti ditandai `FAILED` saat API start.

## D-049 Permission Dokumen, Impor, dan AHSP (menutup bagian OD-008 untuk M5/M7)

Disetujui 2026-10-25.

| Permission | Untuk | Default |
|---|---|---|
| `document.read` | lihat & unduh dokumen proyek | ADMIN, MANAGER |
| `document.upload` | upload dokumen | ADMIN, MANAGER |
| `rabImport.review` | buat run impor, retry, catat keputusan reviewer | ADMIN, MANAGER |
| `rabImport.approve` | approve/reject impor | MANAGER |
| `ahsp.read` | lihat daftar analisa, komponen, daftar harga | FILLER, REVIEWER, MANAGER, ADMIN |

- Approve impor menghasilkan versi daftar harga, analisa/komponen resmi, dan **RAB versi DRAFT** yang tertaut. Approval RAB tetap `rab.approve` (M4); aktivasi baseline M6. Tidak ada jalur approval RAB kedua.
- Semua izin diperiksa backend per proyek dan role dinamis. Sisa OD-008 (progress, laporan, baseline) tetap terbuka.

## D-050 Harga Referensi per Proyek (menutup OD-011)

Scope harga bersama per proyek digantikan D-056: setiap versi RAB memiliki
paket analisa dan harga sendiri. Aturan versioning/approval/histori tetap.

Disetujui 2026-10-25.

- Harga upah/bahan/alat disimpan per proyek dalam **versi daftar harga** (`price_lists`); setiap impor yang di-approve membuat versi baru. Versi lama tidak ditimpa. Belum ada katalog lintas proyek.
- Lokasi dan periode dari sumber menjadi metadata versi daftar harga.
- Konflik harga/referensi (nama sama harga berbeda, kandidat ganda) masuk review.
- Approval ikut approve impor (`rabImport.approve`).
- Versi analisa menunjuk versi daftar harga; item RAB menunjuk versi analisa. RAB approved tetap menunjuk versi yang dipakai saat itu; perubahan master berikutnya tidak mengubah histori.

## D-051 Rumus Harga Satuan Analisa (menutup OD-012)

Disetujui 2026-10-25 berdasarkan bukti workbook SDN 2 Serangan (`ANALISA`, `REKAP ANALISA`, `UPAH`, `BAHAN V`).

- Harga komponen sebelum PPN; PPN dikenakan sekali di RAB (D-043).
- Nilai komponen = harga × koefisien, tanpa pembulatan. Biaya langsung (D) = Σ nilai komponen (tenaga + bahan + alat).
- Overhead/profit = persentase **per versi analisa** dari sumber × D. Harga eksak (F) = D + overhead.
- Harga satuan analisa = pembulatan **sesuai sumber per versi analisa** (`rounding_scale`, HALF_UP). Profil workbook contoh: `ROUND(F, 0)` pada REKAP ANALISA. Bila sumber tidak membulatkan, harga = F. Tidak ada tarif, markup, atau pembulatan default yang diasumsikan; rumus yang tidak terbukti masuk review.
- Harga satuan RAB disimpan maksimal 2 desimal (D-043); harga analisa yang lebih presisi tanpa pembulatan sumber memblokir approval sampai reviewer memutuskan (override dengan alasan).
- **Selisih harga analisa vs harga sumber RAB** memblokir approve impor sampai reviewer memilih: harga analisa, atau override harga sumber dengan alasan. Disimpan: harga sumber, harga analisa, harga efektif, sumber harga, alasan, actor, waktu.
- **Harga langsung/lump sum** (item tanpa analisa yang terbukti memakai harga literal) boleh dengan warning. Baris judul/kelompok tanpa kode tidak dianggap item harga langsung.
- **Analisa bertingkat**: komponen dapat merujuk versi analisa lain; harga komponen mengikuti rumus sumber (harga eksak atau harga yang dibulatkan). Siklus ditolak.
- TKDN tetap ditunda (OD-010).

## D-052 Penelusuran Deterministik, AI 9router, dan Panduan Versi 1

Disetujui 2026-10-25.

- Penelusuran formula, pembacaan blok analisa, dan seluruh kalkulasi deterministik di backend (`apps/api`), Decimal di `packages/calc`.
- Fungsi formula yang didukung v1: referensi sel/range lintas sheet, `VLOOKUP` exact match (`FALSE`/0), `IFERROR`, `ROUND`, `SUM`, `+ - * /`, unary `+/-`, angka/teks literal. Formula lain, referensi eksternal, `VLOOKUP` approximate, atau rantai yang tidak dapat dibuktikan masuk review.
- AI hanya membantu kandidat untuk baris yang rantainya putus/ambigu, dengan bukti; backend memvalidasi kandidat. AI tidak menulis RAB/AHSP resmi.
- 9router (OpenAI-compatible) hanya dipanggil dari `apps/api`: `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, `AI_MODEL`, `AI_FALLBACK_MODEL`. Timeout dan retry terbatas; model fallback dipakai bila model utama gagal secara teknis. Setiap panggilan dicatat (`ai_runs`): model aktual, attempt, versi instruksi, status, error. API key tidak pernah dicatat/ditampilkan. Bila kedua model gagal, impor tetap selesai lewat review manual.
- `docs/RAB_IMPORT_GUIDE.md` versi 1 diintegrasikan sebagai instruksi tetap berversi `rab-import-guide@1` (prompt, structured schema zod, validator, test). Versi tercatat pada setiap run impor.
- Format v1: `.xlsx`. PDF menyusul.

## D-053 Impor Versi Non-Kontrak dan Seed AHSP

Penautan analisa resmi versi lain sebagai dependency bersama digantikan
D-056. Kandidat lama tetap dapat ditinjau, lalu disalin ke paket RAB tujuan.

Disetujui 2026-10-25.

- Impor MC-0/Addendum menghasilkan RAB DRAFT baru dari sumber (bukan salinan). Identitas pekerjaan (`work_item_id`) ditentukan keputusan reviewer per item: cocokkan ke work item versi approved terakhir atau buat baru. Backend menyusun kandidat (jalur kelompok + uraian sama); kandidat tidak pernah diterapkan otomatis.
- Saat approve, baris versi hasil impor ditautkan ke versi sebelumnya seperti salinan: item melalui keputusan work item, baris kelompok melalui jalur struktur yang sama (nomor + nama), agar perbandingan tidak menganggap seluruh item pindah kelompok. Kelompok hanya struktur, bukan identitas pekerjaan.
- Relasi analisa yang rantainya berhenti di nilai (mis. REKAP ANALISA tanpa formula pada workbook MC-0) memerlukan keputusan reviewer; kandidat dari analisa resmi proyek (kode, harga, satuan sama) hanya usulan.
- (Diganti D-057: seed kini membuat `SDN2-SERANGAN-2026-PAKET`.) Seed `npm run db:seed:sample-ahsp` (development) membuat proyek `SDN2-SERANGAN-2026-AHSP` melalui alur impor yang sama: Kontrak dari workbook Penawaran (`00`), MC-0 dari workbook mingguan (`04`). Keputusan pemetaan MC-0 dicatat eksplisit sebagai keputusan reviewer oleh admin seed. Seed berhenti bila rekonsiliasi gagal, aman diulang (melanjutkan langkah yang belum selesai), dan tidak menyentuh proyek, user, role, atau histori lain.

## D-054 Toleransi Rekonsiliasi Nilai Cached Excel

Disetujui 2026-10-25.

- Rekonsiliasi nilai hasil hitung aplikasi (Decimal eksak) terhadap nilai cached workbook memakai **satu batas absolut Rp 0,000001** (`ABS_0.000001`) untuk semua skala nilai. Tidak ada toleransi relatif.
- Nilai cached dibandingkan dari float mentahnya (17 digit), bukan string 15 digit.
- Toleransi hanya untuk rekonsiliasi cached Excel: tidak mengubah nilai aplikasi, tidak dipakai untuk `PRICE_MISMATCH` (harga analisa vs harga RAB tetap dibandingkan eksak).
- Setiap perbandingan dicatat sebagai bukti review pada draft (`reconciliation`: nilai aplikasi, nilai cached, selisih, toleransi, aturan, hasil).

## D-055 Dokumen Utama dan Pendukung dalam Paket Impor

Disetujui 2026-10-25 (temuan review).

- Setiap dokumen paket berperan `RAB` (memiliki sheet RAB/rekap; minimal satu) atau `SUPPORT` (analisa/harga tanpa sheet RAB). Dokumen pendukung tidak ditolak karena tidak memiliki sheet RAB; provenance-nya tetap tercatat.
- Analisa di dokumen pendukung hanya menjadi kandidat untuk baris yang rantainya putus, ambigu, atau merujuk file lain (referensi lintas file belum dapat dibuktikan rumus). Kandidat = kode, satuan, dan harga sama; tidak diterapkan otomatis.
- Analisa kandidat hanya diimpor bila reviewer menautkannya; kandidat yang tidak cocok tidak masuk draft.

## D-056 Paket Analisa dan Harga Mandiri per Versi RAB

Klarifikasi eksplisit pengguna 2026-10-26; menggantikan scope bersama proyek
pada D-045/D-050 serta penautan analisa lintas RAB pada D-053.

- Penawaran/Kontrak, MC0, dan setiap Addendum masing-masing mempunyai rekap,
  analisa, bahan, upah, alat, koefisien, dan harga sendiri. Tidak ada satu
  master gabungan yang dipakai bersama oleh semua versi RAB dalam proyek.
- Analisa Struktur/Arsitektur/MEP yang terpisah dalam Excel digabung hanya
  di dalam paket versi RAB yang sama. Identitas sumber/disiplin tetap ada.
- Beberapa item pada RAB yang sama boleh merujuk analisa/komponen yang sama.
  Kandidat dari RAB sebelumnya tidak menjadi dependency bersama: setelah
  konfirmasi, salin dependency terpakai ke paket tujuan, termasuk subanalisa
  dan harga. Pertahankan provenance ke asal salinan.
- Pembacaan, pencarian, review, dan validasi relasi harus mengetahui versi
  RAB tujuan. Backend mencegah referensi analisa/harga/subanalisa keluar dari
  paket tersebut. Work item permanen tetap per proyek untuk histori progres;
  scope work item tidak berubah karena isolasi data analisa/harga.
- Perubahan paket MC0/Addendum tidak mengubah paket Penawaran/Kontrak atau
  snapshot approved. Tidak menghapus histori lama untuk memisahkan paket.
- Prioritas saat ini: memuat dan memverifikasi RAB lengkap beserta paketnya
  di aplikasi. Jangan lanjut ke progres, laporan, atau aktivasi baseline dulu.
- Implementasi sebelumnya masih berscope proyek. Perubahan ini memerlukan
  rancangan schema/API, migration baru, validasi, UI pemilih versi RAB,
  test isolasi, serta pembaruan panduan/prompt impor ke versi berikutnya.
  Seed lama tidak boleh dipakai sebagai bukti isolasi sebelum relasinya
  diperiksa; seed contoh baru/penyesuaian non-destruktif harus direkonsiliasi.

## D-057 Implementasi Paket per Versi RAB (D-056)

Rancangan schema/API final untuk D-056, 2026-10-26.

- **Paket = versi RAB.** `price_lists.rab_version_id` (unik: satu daftar harga
  per versi RAB) dan `ahsp_analyses.rab_version_id` menyatakan pemilik. Versi
  analisa mengikuti analisanya; daftar harga versi analisa, harga komponen, dan
  subanalisa wajib berada di paket yang sama. Item RAB hanya boleh menautkan
  analisa milik versinya.
- **Provenance salinan:** `ahsp_analysis_versions.copied_from_id` dan
  `price_items.copied_from_id`. `ahsp_analysis_versions.source_import_id`
  boleh kosong untuk salinan dari "Buat versi" (M4).
- **Penyalinan:** satu fungsi backend menyalin analisa terpilih beserta
  subanalisa (rekursif) dan harga terpakai ke paket tujuan dalam transaksi
  yang sama; idempoten per sumber dalam satu paket; paket sumber tidak pernah
  diubah. Dipakai oleh:
  - approve impor MC0/Addendum: kandidat analisa hanya dari paket versi RAB
    approved terakhir (calon `previous_version_id`); keputusan `ANALYSIS_LINK`
    ke kandidat itu menyalin dependency ke paket baru;
  - "Buat versi" MC0/Addendum (M4): item tertaut analisa disalin bersama
    paket yang dipakainya.
- **Validasi:** approve RAB (M4) menolak item yang menautkan analisa di luar
  paket versinya. Pemeriksaan isolasi (item → analisa, analisa → daftar harga,
  komponen → harga, komponen → subanalisa) dipakai test dan seed.
- **API baca berkonteks versi RAB:** `GET /projects/:projectId/rab-versions/
  :versionId/analyses`, `.../analyses/:analysisId`, `.../price-list`.
  Endpoint daftar analisa/harga berscope proyek dihapus.
- **Backfill non-destruktif:** pemilik paket lama diisi dari impor asalnya
  (setiap daftar harga dan versi analisa berasal dari tepat satu impor
  approved). Relasi lintas paket yang sudah approved tidak diubah karena
  histori approved; pada data dev hanya proyek contoh `SDN2-SERANGAN-2026-AHSP`
  (408 item MC-0 menunjuk analisa Kontrak). Pemeriksaan isolasi melaporkannya
  sebagai legacy; proyek itu bukan bukti isolasi. Bukti memakai proyek contoh
  baru `SDN2-SERANGAN-2026-PAKET`.
- **Panduan/prompt:** `rab-import-guide@2`; run lama tetap tercatat `@1`.
- **Addendum pada seed:** belum ada dokumen Addendum kantor. Seed membuat
  Addendum lewat "Buat versi" (salinan MC-0 beserta paketnya) dan
  membiarkannya DRAFT; tidak ada isi Addendum yang dikarang.

## D-058 Pewarisan Analisa Bila MC0/Addendum Tidak Menyertakannya

Klarifikasi pengguna 2026-10-26; melengkapi D-056/D-057.

- Jika sumber MC0/Addendum tidak menyertakan analisa, gunakan analisa dari
  paket versi RAB approved sebelumnya pada rantai revisi proyek. Contoh:
  MC0 dari Kontrak; Addendum 1 dari MC0 bila itulah versi approved sebelumnya;
  Addendum berikutnya dari versi approved terakhir sebelumnya.
- Pewarisan berarti menyalin dependency terpakai ke paket RAB tujuan dalam
  transaksi yang sama: analisa, subanalisa, komponen, koefisien, serta harga.
  ID/ownership tujuan mandiri; provenance menunjuk asal salinan. Tidak
  membuat ketergantungan master mutable bersama antarversi RAB.
- Pemetaan item/analisa tetap mengikuti bukti dan keputusan review D-053;
  pewarisan tidak berarti memakai analisa sembarang hanya karena kode/nama
  mirip. Item baru yang tidak punya pasangan ditandai untuk penyelesaian.
- Jika sumber baru menyertakan analisa, sumber baru menjadi dasar review.
  Formula rusak/ambigu pada sumber baru bukan alasan untuk diam-diam
  menggantinya dengan versi lama. Selisih harga mengikuti D-051; tidak
  otomatis mengubah koefisien/harga lama agar cocok dengan RAB baru.
- UI membedakan analisa dari sumber baru dan analisa warisan, serta
  menampilkan versi asal. Snapshot/histori RAB sumber tetap tidak berubah.
- Prioritas tetap pemuatan paket RAB lengkap di aplikasi; skenario seed dan
  test wajib membuktikan fallback ini beserta isolasi paketnya.

## D-059 Navigasi Analisa di Dalam Lihat RAB

Permintaan pengguna 2026-10-26:

- Hilangkan tab Analisa dari detail proyek. Buka RAB, pilih versi dan Lihat,
  lalu gunakan tab Rekap RAB, Analisa, Bahan, Alat, dan Upah di dalam versi itu.
- URL analisa bersarang di `/projects/:projectId/rab/:versionId/analyses`,
  detail di `.../analyses/:analysisId`. Pencarian, subanalisa, dan tautan
  kembali mempertahankan versi yang dipilih; tidak memilih versi lain otomatis.
- URL lama dengan versi eksplisit diarahkan ke lokasi baru. URL daftar lama
  tanpa versi menuju daftar versi RAB agar pengguna memilih konteksnya.
- Tab Analisa mengikuti `ahsp.read`; backend tetap memeriksa proyek
  dan kepemilikan paket. Ini perubahan navigasi, tidak mengubah data/schema.

## D-060 Rincian AHSP Seperti Lembar RAB

Permintaan pengguna 2026-10-26: Lihat RAB memiliki lima tab: Rekap RAB,
Analisa, Bahan, Alat, Upah. Tiga tab harga dipisahkan menurut kategori
komponen yang memakai harga tersebut dalam paket RAB terpilih, bukan nama
sheet sumber. Satu harga yang dipakai dalam beberapa kategori tampil pada
masing-masing kategori tanpa menduplikasi data.

Detail analisa menampilkan A Tenaga, B Bahan, C Peralatan, koefisien, harga
satuan, jumlah komponen dan subtotal setiap kelompok, D biaya langsung,
E persentase overhead & profit dan jumlahnya, F harga satuan sebelum
pembulatan, serta harga satuan yang dipakai setelah pembulatan sumber.
Subtotal dihitung dengan Decimal di packages/calc. Kelompok kosong tetap
tampil bernilai nol. Angka tersimpan dan aturan pembulatan D-051 tidak berubah.
Pengguna memilih rincian dan overhead dahulu; TKDN tetap ditunda (OD-010).

## D-061 UI Menyeluruh dan Asal Nilai

Permintaan pengguna 2026-10-26: modernkan seluruh halaman dan buat nilai
dapat ditelusuri seperti dependensi sel Excel. Panel Asal nilai menunjukkan
nilai presisi lengkap, penjelasan rumus yang berlaku, operand dan tautan
ke baris/analisa/harga/dokumen. Navigasi mempertahankan proyek dan versi;
baris tujuan disorot dan kelompok induknya dibuka. Data sumber yang tidak
tersimpan ditandai tidak tersedia, tanpa mengarang sel atau aturan baru.

Pratinjau Excel membaca file asli dan nilai cached, tidak mengeksekusi rumus
atau link eksternal. Referensi tertulis dapat dibuka untuk penelusuran
selanjutnya; bukan klaim bahwa setiap cabang rumus dipakai. Akses dokumen
tetap document.read dan akses RAB/AHSP tetap sesuai permission backend.
Input manual/override menampilkan konteks/alasan yang ada; harga warisan
menyediakan tautan paket asal. Tidak ada perubahan kalkulasi atau schema.

## D-062 Satu Tingkat Tab pada Halaman Versi RAB

Koreksi pengguna 2026-10-26: dua tingkat tab pada satu halaman terlalu ramai.
Hilangkan ProjectTabs dari rekap satu versi, daftar/detail analisa, bahan,
alat, dan upah. Pertahankan hanya lima tab paket; navigasi ke proyek dan
daftar versi berupa tautan teks biasa. Daftar versi RAB dan halaman detail
proyek tetap memakai tab proyek. Izin dan konteks versi tidak berubah.

## D-063 Rekonsiliasi Item/Total dan Overhead yang Tidak Dipakai Sumber

Arahan pengguna 2026-10-26 setelah audit SDN2-SERANGAN-2026-PAKET.

- Patokan nilai resmi adalah RAB sumber yang disahkan. Aplikasi menghitung sendiri
  mengikuti rantai rumus, harga, volume, PPN, dan pembulatan yang benar-benar
  dipakai sumber (D-043, D-051); nilai cached workbook hanya pembanding.
- **Overhead tercantum tetapi tidak dipakai**: bila rumus harga kepala analisa
  merujuk biaya langsung D, sedangkan blok memuat baris E = D × persentase,
  parser memberi WARNING `OVERHEAD_UNUSED` (tidak memblokir). Deteksi dari
  bukti rumus, bukan kode item. Pesan memuat persentase, harga yang dipakai,
  dan sel sumber (E, persentase, D). Harga tetap mengikuti sumber (tanpa
  overhead); bukti disimpan di `source_locator.unusedOverhead` analisa dan
  ikut tersalin ke paket versi berikutnya. Contoh: workbook 00 analisa VI.6,
  VIII.4, XXI.3 (data approved tidak diubah).
- **Rekonsiliasi per item**: harga + PPN dan jumlah tiap item dibandingkan
  dengan nilai cached kolom HARGA SAT + PPN dan SUB JUMLAH pada blok versi
  yang dipilih, memakai toleransi D-054. Selisih di atas toleransi menjadi
  WARNING `RAB_ROW_MISMATCH` dengan nilai dan selisihnya; angka aplikasi tidak
  diganti dan tidak ada override otomatis. Bukti disimpan di
  `source_locator.reconciliation` item saat approval.
  Nilai cached disimpan di draft sebagai string 17 digit, karena JSON MySQL
  tidak mempertahankan semua digit double (contoh 31605812.106000002).
- **Rekonsiliasi total**: nominal = total aplikasi vs Σ jumlah item cached
  dijumlahkan eksak (D-054). Sel total workbook dibandingkan terpisah karena
  Excel menjumlahkan float. Status `MATCH`; `FLOAT_RESIDUE` bila nominal cocok
  tetapi sel total berbeda di atas toleransi (sisa float, contoh MC-0 Rp
  0,000006); `MISMATCH` bila nominal berbeda (WARNING `RAB_TOTAL_MISMATCH`).
  REAL COST dan DIBULATKAN tetap dibandingkan eksak seperti sebelumnya.
  Keterbatasan: selisih sel total antara toleransi dan Rp 0,005 yang bukan
  akibat penjumlahan float tidak dapat dibedakan bila setiap item cocok.
- Draft lama (`rab-parser@1`) tidak menyimpan nilai cached item; rekonsiliasi
  per item tampil "belum tersedia" untuk impor tersebut.
- **Keterbatasan presisi 12 desimal** (tanpa migration pada pekerjaan ini):
  volume, koefisien, dan harga komponen/daftar harga disimpan maksimal 12
  desimal (`DECIMAL(30,12)` / `DECIMAL(40,12)`). Nilai sumber dengan 15 digit
  signifikan yang melebihi 12 desimal dibulatkan oleh MySQL saat disimpan,
  sedangkan jumlah dihitung dari nilai sebelum pembulatan. Akibatnya
  koefisien × harga yang tampil dapat berbeda dari jumlah tersimpan hingga
  sekitar Rp 10⁻⁹ (contoh workbook 00: XVIII.9 koefisien 12,3307511653399;
  XXIII.6 harga subanalisa VI.13). Jauh di bawah toleransi D-054; total dan
  harga analisa tidak terpengaruh. Pelebaran skala kolom diputuskan terpisah.

## D-064 Penelusuran Nilai Terbatas pada RAB

Koreksi pengguna 2026-10-26: tidak semua informasi harus dapat diklik.
Batasi penelusuran ke angka RAB dan pendukungnya (AHSP, harga, perbandingan
dan review impor RAB). Identitas, kontrak, SPMK, kalender dan pratinjau
jadwal ditampilkan sebagai teks biasa. Mengoreksi perluasan UI D-061 pada
informasi/jadwal proyek; rumus dan data tidak berubah.

## D-065 Review Paket untuk Pewarisan MC-0/Addendum

Permintaan pengguna 2026-10-26: memutuskan ±200 item impor satu per satu
terlalu berat. Melengkapi D-053 dan D-058; urutan versi tetap Kontrak → MC-0
(opsional) → Addendum 1 dst.

- **Usulan backend, bukan keputusan.** Saat run NEEDS_REVIEW dibuka, backend
  menghitung ulang usulan dari versi RAB approved terakhir (dasar yang sama
  dengan kandidat D-057). Tombol lama "Terima semua kandidat tunggal"
  (dihitung di browser, ikut menerima usulan AI) dihapus: satu kandidat
  bukan otomatis bukti kuat.
- **Pekerjaan permanen** diusulkan cocok hanya bila tepat satu item versi dasar
  memiliki jalur kelompok, uraian, dan satuan sama, dan item itu bukan pasangan
  baris lain di draft maupun sudah dipilih untuk baris lain.
- **Pewarisan analisa** (salinan, bukan tautan bersama) diusulkan hanya bila:
  sumber impor tidak memuat blok analisa sama sekali (`analysisBlocksInSources`
  = 0; draft lama tanpa angka ini tidak mendapat usulan), harga item berupa
  (a) rantai yang berhenti di nilai tanpa rumus dengan kode analisa (dan kode
  kolom NO. ANALISA tidak bertentangan), atau (b) harga literal di baris RAB
  dengan kode NO. ANALISA eksplisit; harga literal tanpa kode tetap harga
  langsung. Lalu tepat satu analisa paket dasar berkode sama, satuan sama,
  dan harga sama persis dengan harga RAB sumber, serta pekerjaan yang sama di
  versi dasar tidak memakai analisa berkode lain (perubahan analisa).
- Bila sumber memuat analisa, sumber baru menjadi dasar (D-058); baris yang
  rantainya putus tidak diwariskan otomatis, tetap kandidat per item.
- Usulan AI, kandidat dokumen pendukung, kandidat ganda, item tanpa pasangan
  (pekerjaan baru), konflik satuan/harga, dan perubahan analisa tidak masuk
  usulan paket; tetap diputuskan eksplisit per item.
- Usulan untuk baris yang sudah punya keputusan manual (mis. harga langsung)
  tidak dibuat untuk jenis keputusan itu.
- **Konfirmasi paket** `POST …/rab-imports/:importId/confirm-proposals`
  (`rabImport.review`) dengan `baseVersionId` dan `token` dari review yang
  ditampilkan; token = SHA-256 atas versi dasar serta setiap baris, jenis, dan
  target usulan (pekerjaan/analisa). Dalam satu transaksi backend membaca satu
  versi dasar, menghitung ulang usulan, dan menolak (409) seluruh konfirmasi
  bila versi dasar atau isi usulan berubah, walaupun baris yang sama masih
  diusulkan. Yang dikonfirmasi adalah seluruh usulan yang ditampilkan. Keputusan
  `WORK_ITEM_MATCH`/`ANALYSIS_LINK` biasa dicatat atas nama reviewer dengan
  alasan berisi bukti, ditambah audit `CONFIRM_RAB_IMPORT_PROPOSALS`.
  Tidak ada keputusan yang dicatat sebelum konfirmasi ini. Tanpa schema baru.
- Approval impor (`rabImport.approve`) tetap menyalin dependency analisa
  terpakai ke paket versi baru secara transaksional (D-057); paket sumber dan
  histori approved tidak berubah. Approval RAB tetap terpisah (M4).
- Panduan `rab-import-guide@3`, parser `rab-parser@3` (angka blok analisa
  sumber). Run lama tetap mencatat versinya.

## D-066 Hapus Run Impor yang Belum Digunakan

Permintaan pengguna 2026-10-26: tombol Hapus pada daftar run agar impor dengan
pemilihan sheet yang salah dapat diulang.

- `DELETE /projects/:projectId/rab-imports/:importId` membutuhkan
  `rabImport.review`. Proyek harus ACTIVE.
- Hanya FAILED, REJECTED, dan NEEDS_REVIEW tanpa hasil RAB/daftar harga/analisa
  resmi yang dapat dihapus. UPLOADED, PROCESSING, dan APPROVED ditolak (409).
- Soft delete melalui `rab_imports.deleted_at`; status asal, draft, keputusan,
  AI run, dokumen dan rantai retry dipertahankan. File asli tidak dihapus dan
  dapat dipakai membuat run baru dengan sheet yang benar.
- Run yang dihapus tidak muncul dalam daftar dan endpoint operasionalnya
  menjawab 404. Penghapusan dan audit `DELETE_RAB_IMPORT` satu transaksi,
  memakai row lock yang sama dengan operasi review/approval.
- Tombol Hapus tersedia pada daftar untuk reviewer, disertai konfirmasi.
  Tidak otomatis membuat ulang atau menyetujui impor.

## D-067 Pasangan Pekerjaan Beda Tanda Baca dan Pencarian Manual

Bug SDSerangan 2026-10-26: Kontrak "Pas.. Kwh Meter …" (WI-0364) dan MC-0
"Pas. Kwh Meter …" tidak mendapat kandidat; UI hanya menawarkan Pekerjaan baru.
Melengkapi D-053 dan D-065. Data historis (WI-0417) tidak dikoreksi otomatis.

- **Beda tanda baca ringan.** Uraian yang hanya berbeda pada tanda baca berulang
  (`..`, `,,`, `;;`, `::` → satu) dianggap pasangan hanya bila jalur kelompok,
  satuan, dan kode analisa baris (kolom NO. ANALISA, atau kunci teks tempat
  rantai harga berhenti) sama dengan item versi approved terakhir; tanpa kode
  analisa di kedua sisi tidak ada pasangan. Tanda baca di antara angka
  (`1..5`) tidak diubah; angka, kode, dan ukuran yang berbeda tidak pernah
  disamakan. Uraian persis sama tetap memakai aturan D-053/D-065.
- Aturan yang sama dipakai untuk kandidat backend per baris (dengan alasan) dan
  usulan review paket D-065. Usulan tetap butuh tepat satu pasangan di kedua
  arah (satu baris draft ↔ satu item dasar), tidak dipakai baris lain, dan
  keputusan manual tidak ditimpa. Kandidat ganda/konflik tetap review per item.
  Kemiripan nama saja tidak pernah menjadi keputusan.
- **Pencarian manual.** `GET …/rab-imports/:importId/work-items?q=&page=`
  (`rabImport.review`) mencari item versi approved terakhir (uraian, WI, kode
  analisa), 20 per halaman, menampilkan uraian, WI, satuan, kelompok, kode
  analisa. UI review menyediakan "Cari pekerjaan lama" di samping kandidat dan
  "Pekerjaan baru", termasuk saat kandidat kosong. Pilihan tetap keputusan
  `WORK_ITEM_MATCH` eksplisit reviewer.
- **Validasi keputusan.** `WORK_ITEM_MATCH` dengan `workItemId` ditolak (400)
  bila pekerjaan bukan item versi approved terakhir proyek ini, atau sudah
  dipilih baris lain (keputusan terakhir maupun dalam permintaan yang sama).
  Audit tetap `DECIDE_RAB_IMPORT_ROW`. Tanpa schema baru; berlaku untuk impor
  dan review berikutnya, draft lama menyimpan kandidat lama.

## D-068 Role Editor RAB, Reopen dan Koreksi dari Sumber

Disetujui pengguna 2026-10-26: buka kembali **versi yang sama** dengan
snapshot lama, alasan, audit dan approval ulang; role hanya pada proyek
yang ditugaskan. Menggantikan kunci approved permanen D-040 khusus alur ini.

- Role proyek `RAB_EDITOR`, permission backend `rab.reopen` dan `ahsp.edit`;
  tidak memberi akses global dan tidak menaikkan permission role lama.
- Status `APPROVED -> REOPENED -> APPROVED`; satu draft/koreksi per proyek,
  tidak dapat discard baseline yang sudah pernah approved.
- Snapshot approval lengkap dan checksum disimpan append-only. Snapshot lama,
  dokumen asli, paket versi lain dan histori tetap utuh.
- Edit pada sumber angka: harga dasar/koefisien/analisa atau input RAB;
  dependency terpakai dihitung ulang secara Decimal dalam satu transaksi
  dengan audit. Faktor konversi dan override eksplisit tetap dihormati.
- Urutan baseline mengikuti jenis/nomor versi, bukan tanggal approval ulang.
- Koreksi identitas WI tersedia tanpa menghapus master/riwayat WI lama.
- (2026-10-28) Mengubah urutan baris (drag) pada versi REOPENED tidak meminta
  alasan dan tidak memberi tanda koreksi pada baris, karena tidak mengubah
  nilai apa pun. Izin `rab.reopen` tetap diperlukan, perubahan tetap dicatat di
  audit (`CORRECT_RAB_ITEM`, operation `REORDER`), dan versi tetap harus
  di-approve ulang bersama koreksi lain.
- Rancangan rinci, otorisasi, API/UI yang harus tersedia, dan skenario uji
  terdapat di `docs/RAB_CORRECTIONS.md`; implementasi harus mengikutinya.

## D-069 Dokumen RAB: Kontrak dan MC-0 … MC-100

Disetujui pengguna 2026-10-27: dokumen RAB proyek hanya **RAB Kontrak** dan
**MC**, dan MC bisa banyak (MC-0 sampai MC-100). Addendum bukan lagi jenis
versi. Mengganti aturan jenis/urutan versi pada D-040 (MC0 sekali, lalu
Addendum n), D-058 dan D-065 (sebutan "MC0/Addendum" kini berarti MC).

- `rab_versions.version_type`: `CONTRACT` | `MC`; `revision_number` = nomor MC
  (0 … 100), 0 untuk Kontrak. Urutan domain Kontrak → MC-0 → MC-1 … MC-100;
  label `Kontrak` / `MC-n` (`rabVersionLabel`).
- Nomor MC dipilih pengguna dan boleh meloncat (mis. MC-0, MC-1, MC-30, MC-50,
  MC-75, MC-100), asal lebih besar dari MC tertinggi yang tidak di-discard dan
  ≤ 100 (409 bila tidak; 400 bila di luar 0–100). MC pertama boleh bernomor
  berapa pun. Tanpa nomor, dipakai nomor terkecil yang diizinkan. Hanya setelah
  Kontrak approved; tetap satu DRAFT/REOPENED per proyek. Setiap MC menyalin
  versi approved terakhir (Buat versi) atau berasal dari impor.
- Impor MC: nomor MC ditetapkan saat run dibuat (`rab_imports.target_revision_number`,
  ikut saat retry) dan memilih blok "MC - n" di sheet RAB (`rab-parser@4`,
  `rab-import-guide@4`). Approve memeriksa ulang nomor itu (409 bila sudah tidak
  diizinkan).
- Migrasi `20261027120000_rab_mc_versions`: MC0 → MC 0, ADDENDUM n → MC n
  (versi dan run impor, termasuk draft JSON). Snapshot approval dan audit log
  tidak diubah; snapshot lama tetap mencatat `MC0`/`MC-0` sebagai sejarah.
- Seed `db:seed:sample-ahsp` kini membuat MC-1 (dulu Addendum 1) lewat Buat versi.
- Tanggal efektif D-020 (dulu untuk Addendum) berlaku untuk setiap MC
  (MC-0 … MC-100): default minggu berikutnya (`NEXT_WEEK`), tanggal pasti
  (`EXACT_DATE`, termasuk tengah minggu lewat segmen baseline harian) bila
  dokumen resmi mewajibkan. Minggu sebelum tanggal efektif tidak dihitung ulang.
  Disetujui pengguna 2026-10-27 (menutup OD-013); diterapkan saat baseline M6.


## D-070 Batalkan Koreksi RAB (kembali ke snapshot approved)

Tanggal: 2026-10-28. Melengkapi D-068 atas permintaan pengguna: koreksi yang
tidak jadi dapat dibatalkan tanpa approve ulang.

- `POST /rab-versions/:id/cancel-correction { reason }` hanya untuk versi
  REOPENED. Izinnya sama dengan membuka koreksi (`rab.reopen`), dan alasan
  wajib.
- Versi dikembalikan persis ke snapshot approved terakhir:
  - baris (nilai, induk, urutan, WI, provenance) dan data dokumen;
  - harga dasar, analisa (overhead, pembulatan, nilai turunan), dan komponen
    paket;
  - status, total, serta approver dan waktu approval.
- Baris yang ditambahkan selama koreksi dihapus. WI baru miliknya ikut
  dihapus bila tidak dipakai di tempat lain.
- Hasil pemulihan dihitung ulang menjadi payload snapshot dan dibandingkan
  dengan checksum snapshot. Bila tidak sama persis, transaksi dibatalkan
  (`409`) dan versi tetap REOPENED. Tidak ada pemulihan sebagian.
- Tidak membuat snapshot baru. Event `CORRECT_*` tetap di riwayat, ditambah
  `CANCEL_RAB_CORRECTION` (alasan, nomor snapshot, checksum, jumlah baris
  dihapus).
- D-068 tetap berlaku: versi yang pernah approved tidak dapat di-discard.
  Pembatalan koreksi hanya kembali ke kondisi approved terakhir.

## Keputusan Terbuka



Belum diputuskan. Jangan diimplementasikan dengan asumsi. Ajukan beserta rekomendasi dan konsekuensinya sebelum milestone terkait dimulai.

### OD-001 Status ekstraksi AI setelah retry gagal

Sudah diputuskan: lihat D-048.


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


Untuk dokumen, impor, dan AHSP (M5/M7): diputuskan di D-049. Sisanya tetap terbuka.
### OD-009 Verifikasi rumus RAB terhadap workbook kantor

Sudah diputuskan: lihat D-043.

### OD-010 TKDN pada RAB

Workbook kantor memuat kolom TKDN (%) per item (dari REKAP ANALISA) dan nilai TKDN = jumlah × TKDN%, beserta rekap TKDN per bagian dan total. Belum ada di PRD. Perlu diputuskan: apakah disimpan per item RAB atau diturunkan dari AHSP, dan apakah ditampilkan/diekspor.

Diputuskan sebelum: Milestone 7 (AHSP) atau Milestone 14 (export), mana yang lebih dulu membutuhkannya.

### OD-011 Harga Referensi dan Approval Paket Analisa Lengkap

Sudah diputuskan: lihat D-050.


### OD-012 Komposisi Harga Satuan Analisa dan Rekonsiliasi RAB

Sudah diputuskan: lihat D-051.

### OD-013 Tanggal efektif MC (pengganti D-020 Addendum)

**Ditutup 2026-10-27 oleh D-069:** setiap MC memakai aturan D-020 (default
minggu berikutnya; tanggal pasti bila dokumen resmi mewajibkan).
