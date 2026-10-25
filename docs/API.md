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
GET  /auth/me               -> { id, name, email, isSystemAdmin }
POST /auth/change-password  { currentPassword, newPassword } -> cabut semua session, wajib login ulang
```

- tidak ada endpoint pendaftaran publik
- gagal login selalu `401 { message: "Email atau password salah." }`
- terlalu banyak percobaan: `429`
- cookie `lp_session` HTTP-only, `SameSite=Lax`, `Secure` di HTTPS (D-031)
- POST/PUT/PATCH/DELETE wajib header `Origin` = origin `APP_URL`

## 2. Projects (membership aktif)

```text
GET /projects              -> proyek dengan membership aktif user + role
GET /projects/:projectId   -> identitas proyek (izin project.read)
```

Tanpa membership aktif: `404`, termasuk system admin (D-033). Create/update proyek dikerjakan di Milestone 3.

## 3. Administrasi (system admin saja)

Semua endpoint `/admin/*` mengembalikan `403` untuk non-system-admin.

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
```

- response user: `{ id, name, email, isActive, isSystemAdmin, createdAt, updatedAt }`; tanpa password hash/token
- email duplikat: `409`
- menonaktifkan/mencabut system admin aktif terakhir: `409`
- `pageSize` maksimal 100

### Projects & Members

```text
GET    /admin/projects?search=                       -> [{ id, code, projectName }]
GET    /admin/projects/:projectId/members            -> { project, members: [{ userId, name, email, isActive, role, createdAt }] }
POST   /admin/projects/:projectId/members            { userId, role }
PATCH  /admin/projects/:projectId/members/:userId    { role }
DELETE /admin/projects/:projectId/members/:userId    { reason? }
```

- hanya metadata minimum (D-026)
- user harus aktif; membership aktif ganda: `409`
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

```text
GET  /projects/:projectId/rab-versions
GET  /rab-versions/:versionId
GET  /rab-versions/:versionId/items
GET  /rab-versions/:versionId/compare/:otherVersionId
POST /rab-versions/:versionId/activate
```

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
GET /projects/:projectId/weeks
GET /weeks/:weekId
```

Weeks biasanya generated dari start date + duration.

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
