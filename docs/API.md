# API Plan

Semua endpoint di bawah adalah rancangan awal.

Base:

```text
/api
```

## 1. Auth

```text
POST /auth/login            { email, password }  -> set cookie, user aktif
POST /auth/logout           -> cabut session saat ini, hapus cookie
GET  /auth/me               -> { id, name, email, isSystemAdmin, permissions }  (permission global efektif)
POST /auth/change-password  { currentPassword, newPassword } -> cabut semua session, wajib login ulang
```

- tidak ada endpoint pendaftaran publik
- gagal login selalu `401 { message: "Email atau password salah." }`
- terlalu banyak percobaan gagal untuk satu email: `429` (D-030)
- cookie `lp_session` HTTP-only, `SameSite=Lax`, `Secure` di HTTPS (D-031)
- POST/PUT/PATCH/DELETE wajib header `Origin` = origin `APP_URL`

## 2. Projects

```text
GET   /projects?search=&page=&pageSize=&status=   -> Paginated<{ id, code, projectName, fiscalYear, status, startDate, plannedFinishDate, role | null }>
POST  /projects                                   { identitas, kontrak, SPMK }  -> ProjectDto (201)
GET   /projects/:projectId                        -> ProjectDto
PATCH /projects/:projectId                        { field identitas/kontrak/SPMK?, reason? }
PUT   /projects/:projectId/schedule               { startDate, durationDays, reason }
POST  /projects/:projectId/close                  { reason }
POST  /projects/:projectId/reopen                 { reason }
GET   /projects/:projectId/weeks                  -> [{ id, weekNumber, periodNumber, startDate, endDate, days }]
GET   /projects/:projectId/report-periods         -> [{ id, periodNumber, startDate, endDate, firstWeekNumber, lastWeekNumber, days }]
GET   /projects/:projectId/team                   -> [{ userId, name, role: { id, code, name } }]
```

- `ProjectDto`: `{ id, code, activityName, subActivityName, projectName, location, fiscalYear, contractorName, consultantName, contractNumber, contractDate, contractValue, spmkNumber, spmkDate, startDate, durationDays, plannedFinishDate, status, createdAt, updatedAt }`
- tanggal `YYYY-MM-DD`; `contractValue` decimal string maks. 2 desimal (`null` untuk proyek lama yang belum diisi); `plannedFinishDate` dihitung (D-036)
- `GET /projects`: super admin melihat semua proyek (`role: null` bila tanpa membership); user lain hanya proyek yang detailnya dapat dibuka: membership aktif dengan role aktif yang memiliki `project.read`. Cari kode/nama; `pageSize` maks. 100
- `POST /projects`: `projects.create`; pembuat menjadi MANAGER. Role MANAGER tanpa `project.read`/`project.update`: `409` (D-039). Kode duplikat: `409`
- `PATCH`, `schedule`, `close`, `reopen`: `project.update`. Proyek `CLOSED`: `409` untuk `PATCH` dan `schedule`. `close` pada proyek CLOSED / `reopen` pada proyek ACTIVE: `409`
- `schedule` membentuk ulang minggu/periode dalam transaksi yang sama; ID nomor yang sama dipertahankan; baris akhir yang memiliki data terkait: `409` (D-038)
- `weeks`, `report-periods`, `team`: `project.read`. `team` hanya membership aktif user aktif, tanpa email
- tanpa membership aktif: `404` (D-033); tanpa permission: `403`

## 3. Manajemen Akses

Permission per endpoint: `docs/PERMISSIONS.md` §5. Tanpa permission: `403`.

### Users

```text
GET   /admin/users?search=&page=&pageSize=&active=   -> { items, total, page, pageSize }
POST  /admin/users                       { name, email, password, isSystemAdmin? }
GET   /admin/users/:userId
PATCH /admin/users/:userId               { name?, email?, reason? }
POST  /admin/users/:userId/activate      { reason? }
POST  /admin/users/:userId/deactivate    { reason? }  -> cabut semua session
POST  /admin/users/:userId/grant-system-admin   { reason? }
POST  /admin/users/:userId/revoke-system-admin  { reason? }
GET   /admin/users/:userId/access        -> { user, globalRoles, projects }
POST  /admin/users/:userId/global-roles  { roleId }
DELETE /admin/users/:userId/global-roles/:roleId
```

- response user: `{ id, name, email, isActive, isSystemAdmin, createdAt, updatedAt }`; tanpa password hash/token
- email duplikat: `409`
- menonaktifkan/mencabut super admin aktif terakhir: `409`
- `pageSize` maksimal 100

### Roles

```text
GET   /admin/permissions                 -> katalog PERMISSIONS
GET   /admin/roles?scope=PROJECT|GLOBAL  -> RoleDto[]
POST  /admin/roles                       { code, name, description?, scope }
GET   /admin/roles/:roleId
PATCH /admin/roles/:roleId               { code?, name?, description?, isActive? }
PUT   /admin/roles/:roleId/permissions   { permissionCodes }
```

- `RoleDto`: `{ id, code, name, description, scope, isSystem, isActive, permissionCodes, createdAt, updatedAt }`
- kode duplikat: `409`; kode/status role sistem diubah: `400`; permission tidak dikenal/beda scope: `400`

### Projects & Members

```text
GET    /admin/projects?search=&page=&pageSize=       -> Paginated<{ id, code, projectName }>
GET    /admin/projects/:projectId/members            -> { project, members: [{ userId, name, email, isActive, role, createdAt }] }
GET    /admin/projects/:projectId/member-candidates?search=  -> [{ id, name, email }]
POST   /admin/projects/:projectId/members            { userId, roleId }
PATCH  /admin/projects/:projectId/members/:userId    { roleId }
DELETE /admin/projects/:projectId/members/:userId    { reason? }
```

- hanya metadata minimum; `role` = `{ id, code, name, isActive }`
- user harus aktif; role harus scope PROJECT dan aktif; membership aktif ganda: `409`
- pemegang delegasi tidak boleh mengubah akses dirinya sendiri: `403`
- `member-candidates`: user aktif yang belum menjadi anggota aktif, maks. 20, cari nama/email; tidak memuat diri sendiri bagi pemegang delegasi; tidak membutuhkan `users.read`
- DELETE mencabut membership (`revoked_at`), tidak menghapus user atau histori; menambah ulang mengaktifkan baris yang sama

## 4. Documents (D-049)

```text
GET  /projects/:projectId/documents                       document.read
POST /projects/:projectId/documents   multipart files[]   document.upload   -> DocumentDto[] (201)
GET  /projects/:projectId/documents/:documentId/download  document.read
```

- v1 hanya `.xlsx` (ZIP signature + ekstensi), maks. 30 MB per file
- `DocumentDto`: `{ id, originalFilename, mimeType, fileSize, sha256, uploadedBy, uploadedAt }`

## 5. RAB Import (D-048–D-053)

```text
GET  /projects/:projectId/rab-imports                                  rabImport.review | rabImport.approve
POST /projects/:projectId/rab-imports   { targetVersionType, sources: [{ documentId, role: RAB|SUPPORT, rabSheet? }] }   rabImport.review -> 201, status UPLOADED → diproses di latar
GET  /projects/:projectId/rab-imports/:importId                        rabImport.review | rabImport.approve -> { import, draft, issues, decisions, aiRuns, reconciliation, packageReview }
POST /projects/:projectId/rab-imports/:importId/decisions  { rowKey, kind, value, reason? }   rabImport.review
POST /projects/:projectId/rab-imports/:importId/confirm-proposals  { baseVersionId, token }   rabImport.review (D-065)
GET  /projects/:projectId/rab-imports/:importId/work-items?q=&page=    rabImport.review -> { baseVersion, items, total, page, pageSize } (D-067)
POST /projects/:projectId/rab-imports/:importId/retry                  rabImport.review -> run baru
DELETE /projects/:projectId/rab-imports/:importId                     rabImport.review -> 204, soft delete run belum digunakan (D-066)
POST /projects/:projectId/rab-imports/:importId/approve                rabImport.approve
POST /projects/:projectId/rab-imports/:importId/reject   { reason }    rabImport.approve
```

- `rabSheet` wajib bila dokumen RAB punya lebih dari satu kandidat sheet; dokumen `SUPPORT` tidak perlu sheet RAB (D-055)
- keputusan hanya pada status `NEEDS_REVIEW`; approve ditolak (`409`) bila masih ada issue `BLOCKING`
- approve dalam satu transaksi: versi daftar harga, analisa/versi/komponen terpakai, RAB versi DRAFT tertaut, audit; mengikuti aturan urutan versi M4 (satu DRAFT per proyek)
- AI dipakai otomatis saat pemrosesan untuk baris putus/ambigu bila 9router dikonfigurasi; hasilnya hanya kandidat
- `packageReview` (D-065; null bila Kontrak atau run tidak NEEDS_REVIEW): `baseVersion` ({ id, label } versi approved terakhir), `token` (SHA-256 atas versi dasar + baris/jenis/target setiap usulan), `sourceHasAnalyses` (null untuk draft lama tanpa angka blok analisa), `counts` (`fromSource`, `inherit`, `match`, `newItems`, `problems`), `proposals` ([{ rowKey, description, workItem?: { workItemId, code, reason }, analysis?: { analysisVersionId, code, reason } }])
- `WORK_ITEM_MATCH` (D-067): `workItemId` harus item versi approved terakhir proyek ini dan belum dipilih baris lain, selain itu `400`; `work-items` mencari item versi itu (uraian/WI/kode analisa, 20 per halaman): `items` [{ workItemId, code, description, groupPath, unit, analysisCode }]; kandidat baris dapat memuat `unit`, `analysisCode`, `reason` (beda tanda baca)
- `confirm-proposals`: `baseVersionId` dan `token` dari `packageReview` yang ditampilkan; backend menghitung ulang seluruh usulan dalam transaksi, `409` bila versi dasar atau isi usulan berubah (tidak ada yang dicatat); seluruh usulan yang ditampilkan dikonfirmasi; sukses mencatat keputusan biasa atas nama reviewer + audit `CONFIRM_RAB_IMPORT_PROPOSALS`
- `reconciliation` (D-063): `realCost`, `rounded`, `workbookRealCost`, `workbookRounded`, `matches`, `value` (total eksak), `rowsChecked`, `rowsMismatched`, `totalStatus` (`MATCH` | `FLOAT_RESIDUE` | `MISMATCH` | null), `entries` (perbandingan total D-054); selisih item/total dan `OVERHEAD_UNUSED` muncul sebagai issue `WARNING`

## 6. RAB

Milestone 4. Route bersarang di proyek agar permission proyek diperiksa (D-041).

```text
GET   /projects/:projectId/rab-versions                         -> RabVersionSummaryDto[]           rab.read
POST  /projects/:projectId/rab-versions                         { versionType, documentNumber?, documentDate? }   rab.edit
GET   /projects/:projectId/rab-versions/:versionId              -> { version, rows, totals, issues } rab.read
PATCH /projects/:projectId/rab-versions/:versionId              { documentNumber?, documentDate? }  rab.edit
POST  /projects/:projectId/rab-versions/:versionId/items        { parentId?, rowType, displayNumber?, description, volume?, unit?, analysisCode?, unitPrice?, taxPercent? }   rab.edit
PATCH /projects/:projectId/rab-versions/:versionId/items/:itemId   { field?, parentId? }        rab.edit
DELETE /projects/:projectId/rab-versions/:versionId/items/:itemId                               rab.edit
POST  /projects/:projectId/rab-versions/:versionId/items/:itemId/move  { direction: up|down }   rab.edit
POST  /projects/:projectId/rab-versions/:versionId/items/reorder     { parentId, itemIds[] }  rab.edit
POST  /projects/:projectId/rab-versions/:versionId/approve      { acknowledgeWarnings }          rab.approve
POST  /projects/:projectId/rab-versions/:versionId/discard      { reason }                       rab.edit (DRAFT saja; REOPENED 409)
POST  /projects/:projectId/rab-versions/:versionId/reopen       { reason }                       rab.reopen (D-068)
POST  /projects/:projectId/rab-versions/:versionId/cancel-correction { reason }                  rab.reopen (D-070)
GET   /projects/:projectId/baselines                              —                                rab.read (D-071)
POST  /projects/:projectId/baselines                              { rabVersionId, activationMode, effectiveFrom?, reason? }  baseline.activate
POST  /projects/:projectId/baselines/:assignmentId/revoke         { reason }                       baseline.activate
GET   /projects/:projectId/rab-versions/:versionId/history      -> { snapshots, events }         rab.read + ahsp.read
GET   /projects/:projectId/rab-versions/:versionId/snapshots/:snapshotId -> { …, checksumValid, payload } rab.read + ahsp.read
POST  /projects/:projectId/rab-versions/:versionId/items/:itemId/work-item  { workItemId, reason? }  rab.edit
GET   /projects/:projectId/rab-versions/:baseId/compare/:targetId -> { base, target, rows, totals } rab.read
POST  /projects/:projectId/rab-versions/:versionId/activate     (Milestone 6)
```

- angka (volume, harga, PPN, jumlah, bobot) berupa decimal string eksak (D-043); input volume maks. 12 desimal, harga 2 desimal, PPN 0–100 maks. 2 desimal
- `totals`: `{ beforeTax, tax, value, realCost, rounded }` — `realCost` = ROUND(value, 2), `rounded` = DIBULATKAN (dipotong ke rupiah)
- MC menyalin versi approved terakhir menurut urutan domain Kontrak → MC-0 → MC-1 … MC-100 (D-069; `revisionNumber` opsional 0–100, boleh meloncat asal lebih besar dari MC terakhir; kosong = nomor terkecil yang diizinkan) (bukan waktu approval); urutan salah atau masih ada DRAFT/REOPENED: `409`
- versi bukan DRAFT/REOPENED atau proyek CLOSED: `409` untuk semua perubahan
- REOPENED (D-068): setiap perubahan (termasuk PATCH/POST/DELETE baris, move/reorder, data dokumen) butuh `rab.reopen` selain izin endpoint (`403`) dan `reason` di body (`400`); dicatat `CORRECT_*` dengan before/after dan ditandai di `sourceLocator.corrections`. Baris yang sudah ada saat approval terakhir tidak dapat dihapus (`409`). Harga item ANALYSIS tetap dari analisa (`409`). Reorder tidak butuh `reason` dan tidak menandai baris (D-068, 2026-10-28)
- `cancel-correction` (D-070): hanya REOPENED (`409`), memulihkan snapshot approved terakhir secara persis (diverifikasi checksum, `409` bila tidak sama), status kembali APPROVED tanpa snapshot baru; audit `CANCEL_RAB_CORRECTION`
- approve versi REOPENED = approve ulang dengan seluruh validasi; setiap approval menambah snapshot (urutan, payload JSON kanonis, SHA-256). Reopen versi approved lama tanpa snapshot membekukan kondisinya lebih dulu
- koreksi WI: `workItemId` harus item versi sebelumnya proyek ini (`400`), tidak dipakai item lain versi ini (`409`); WI lama tidak dihapus
- baris: SECTION hanya di tingkat teratas; induk bukan ITEM dan dari versi yang sama: `400`; menghapus baris yang punya sub-baris: `409`
- `issues`: `{ errors: [{ itemId?, message }], warnings: [...] }`; approve dengan error: `409`; ada warning tanpa `acknowledgeWarnings: true`: `409`
- `rows` urut pohon dengan `depth`; baris non-ITEM membawa jumlah & bobot agregat sub-barisnya
- compare: baris ITEM dicocokkan dengan `workItemId`; `change` = NEW | MODIFIED | REMOVED | UNCHANGED; `changes` = field yang berbeda (`description`, `unit`, `analysisCode`, `volume`, `unitPrice`, `taxPercent`, `group`); `baseGroup`/`targetGroup` = jalur kelompok (mis. `B › B.II`). `group` berarti pindah bagian/sub-bagian/induk; kelompok dikenali lewat rantai salinan (`previous_version_item_id`), sehingga ID baru hasil salinan bukan perubahan

## 7. AHSP (D-049–D-051)

Paket analisa/harga dimiliki versi RAB (D-056, D-057). Semua pembacaan
berkonteks versi RAB; backend memeriksa versi milik proyek dan analisa milik
paket versi itu (selain itu 404).

```text
GET /projects/:projectId/rab-versions/:versionId/analyses?search=         ahsp.read -> daftar gabungan paket versi RAB
GET /projects/:projectId/rab-versions/:versionId/analyses/:analysisId     ahsp.read -> komponen, sumber/provenance, item RAB versi itu
GET /projects/:projectId/rab-versions/:versionId/price-list?search=       ahsp.read -> harga upah/bahan/alat paket (null bila belum ada)
PATCH /projects/:projectId/rab-versions/:versionId/price-items/:priceItemId              { price?, unit?, reason? }                 ahsp.edit (D-068)
PATCH /projects/:projectId/rab-versions/:versionId/components/:componentId               { coefficient?, unitPrice?, factor?, reason? } ahsp.edit
- `unit` harga dasar adalah label: tidak menghitung ulang apa pun, tetapi tetap ditandai koreksi dan diaudit. `factor` komponen ditulis seperti `/8`, `÷ 4`, `×2` (kosong = tanpa konversi; format lain `400`). Hanya untuk komponen bertaut harga dasar/subanalisa (`409` untuk komponen manual). Harga komponen dihitung ulang dari sumbernya × faktor, disimpan di `source_locator.factor`, lalu analisa dan item RAB ikut dihitung ulang.
PATCH /projects/:projectId/rab-versions/:versionId/analysis-versions/:analysisVersionId  { overheadPercent?, roundingScale?, reason? } ahsp.edit
```

Koreksi sumber (D-068) hanya pada paket versi DRAFT/REOPENED (REOPENED: juga
`rab.reopen` + `reason`). Respons = detail versi RAB. Dalam satu transaksi
backend menghitung ulang yang terdampak saja (komponen dengan faktor
`source_locator.factor`, subanalisa EXACT/ROUNDED, analisa, item ANALYSIS;
item SOURCE_OVERRIDE/DIRECT hanya `analysisUnitPrice`) dan menulis satu audit.
`409` bila: harga komponen tertaut diedit langsung, siklus subanalisa, relasi
keluar paket, harga komponen tersimpan tidak terbukti berasal dari sumbernya,
hasil melebihi presisi kolom, atau harga item ANALYSIS baru > 2 desimal
(`errors[]` berisi rinciannya; tetapkan pembulatan analisa lebih dahulu).

`AhspAnalysisSummaryDto.latestVersion.copiedFrom` dan
`AhspAnalysisDetailDto.versions[].copiedFrom` berisi asal salinan
(`{ analysisVersionId, rabVersion }`) atau `null`. `RabRowDto.analysis.rabVersionId`
adalah pemilik analisa yang ditautkan item.

## 8. Schedule

```text
GET  /projects/:projectId/schedules
POST /projects/:projectId/schedules
GET  /schedules/:scheduleVersionId
```

## 9. Weeks

```text
GET /projects/:projectId/weeks   (Milestone 3, lihat §2)
GET /weeks/:weekId
```

Weeks dibentuk dari start date + duration (D-037).

## 10. Weekly Progress

```text
GET /weeks/:weekId/progress
PUT /weeks/:weekId/progress
```

Gunakan bulk payload.

Contoh:

```json
{
  "items": [
    {
      "workItemId": "uuid",
      "inputMode": "VOLUME_WEEK",
      "value": "5.2500",
      "note": ""
    }
  ]
}
```

## 11. Daily Allocation

```text
GET  /weeks/:weekId/daily-allocations
POST /weeks/:weekId/daily-allocations/generate
PUT  /weeks/:weekId/daily-allocations
```

## 12. Daily Reports

```text
GET   /projects/:projectId/daily-reports?from=&to=
GET   /daily-reports/:dailyReportId
PATCH /daily-reports/:dailyReportId
POST  /daily-reports/:dailyReportId/submit
POST  /daily-reports/:dailyReportId/finalize
POST  /daily-reports/:dailyReportId/reopen
```

Subresource jika dibutuhkan:

```text
PUT /daily-reports/:id/labor
PUT /daily-reports/:id/materials
PUT /daily-reports/:id/equipment
PUT /daily-reports/:id/weather
```

## 13. Weekly Reports

```text
GET  /weeks/:weekId/report
POST /weeks/:weekId/report/finalize
POST /weeks/:weekId/report/reopen
```

## 14. 4-Week Reports

```text
GET  /projects/:projectId/report-periods
GET  /report-periods/:periodId/report
POST /report-periods/:periodId/finalize
POST /report-periods/:periodId/reopen
```

## 15. Exports

```text
POST /report-snapshots/:snapshotId/exports
GET  /report-exports/:exportId/download
```

Payload:

```json
{
  "format": "PDF"
}
```

## 16. Audit

```text
GET /projects/:projectId/audit-logs
GET /audit-logs/:auditLogId
```

## 17. Health

```text
GET /health
```

`/health/database` ditunda sampai dibutuhkan.

Jangan expose detail sensitif ke public health endpoint.

## 18. API Conventions

- decimal values dikirim sebagai string
- timestamp ISO 8601
- UUID untuk public IDs bila dipilih
- error response konsisten
- pagination untuk daftar besar
- authorization server-side
- bulk endpoint untuk progress

D-060: `GET /projects/:projectId/rab-versions/:versionId/price-list` menerima
`category=LABOR|MATERIAL|EQUIPMENT` opsional, bersama `search`. Nilai kategori
lain menghasilkan 400. Filter berdasarkan pemakaian komponen dalam paket
ini. Setiap item mengembalikan `categories`; detail versi analisa menambahkan
`categoryTotals` (LABOR/MATERIAL/EQUIPMENT, decimal string). Tetap `ahsp.read`.

D-061: baris RAB menambahkan `sourceLocator` (provenance tersimpan),
`sourceUnitPrice`, `analysisUnitPrice`, dan `priceDecidedAt` untuk penjelasan
keputusan harga. `GET /projects/:projectId/documents/:documentId/preview`
(`document.read`) menerima `sheet` dan `cell` (A1 secara default), menghasilkan
nama dokumen, daftar sheet, sel terpilih (nilai cached, formula, referensi),
dan jendela sekitar sel (maksimal 11×12). Tidak menjalankan rumus/link luar.
