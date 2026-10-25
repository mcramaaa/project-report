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

## 4. Documents

```text
GET  /projects/:projectId/documents
POST /projects/:projectId/documents
GET  /documents/:documentId
GET  /documents/:documentId/download
```

## 5. AI Extraction

```text
POST /documents/:documentId/extractions
GET  /ai-extractions/:extractionId
GET  /ai-extractions/:extractionId/rows
PATCH /ai-extractions/:extractionId/rows/:rowId
POST /ai-extractions/:extractionId/retry
POST /ai-extractions/:extractionId/approve
POST /ai-extractions/:extractionId/reject
```

Approval harus transaction-safe.

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
POST  /projects/:projectId/rab-versions/:versionId/approve      { acknowledgeWarnings }          rab.approve
POST  /projects/:projectId/rab-versions/:versionId/discard      { reason }                       rab.edit
GET   /projects/:projectId/rab-versions/:baseId/compare/:targetId -> { base, target, rows, totals } rab.read
POST  /projects/:projectId/rab-versions/:versionId/activate     (Milestone 6)
```

- angka (volume, harga, PPN, jumlah, bobot) berupa decimal string; volume maks. 4 desimal, harga 2 desimal, PPN 0–100 maks. 2 desimal
- MC0/ADDENDUM menyalin versi approved terakhir; urutan salah atau masih ada DRAFT: `409`
- versi bukan DRAFT atau proyek CLOSED: `409` untuk semua perubahan
- baris: SECTION hanya di tingkat teratas; induk bukan ITEM dan dari versi yang sama: `400`; menghapus baris yang punya sub-baris: `409`
- `issues`: `{ errors: [{ itemId?, message }], warnings: [...] }`; approve dengan error: `409`; ada warning tanpa `acknowledgeWarnings: true`: `409`
- `rows` urut pohon dengan `depth`; baris non-ITEM membawa jumlah & bobot agregat sub-barisnya
- compare: baris ITEM dicocokkan dengan `workItemId`; `change` = NEW | MODIFIED | REMOVED | UNCHANGED

## 7. AHSP

```text
GET    /ahsp
POST   /ahsp
GET    /ahsp/:analysisId
PATCH  /ahsp/:analysisId
GET    /ahsp/:analysisId/versions
POST   /ahsp/:analysisId/versions
```

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
