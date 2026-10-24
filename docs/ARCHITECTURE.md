# Architecture

## 1. High-Level

```text
Browser
  |
  v
Next.js Web
  |
  v
NestJS API
  |--------------------|
  v                    v
MySQL                Storage
  |
  +---- business/domain services
  |
  +---- 9router -> AI model
```

Untuk akses luar:

```text
Internet
  |
Cloudflare Tunnel
  |
Web/API
```

9router tetap localhost dan tidak diekspos.

## 2. Monorepo

```text
apps/
  web/
  api/

packages/
  calc/
  shared/
  config/

prisma/
storage/
docs/
```

## 3. Responsibility

### apps/web
- UI
- navigation
- forms
- editable grids
- preview
- user feedback

Tidak boleh menjadi satu-satunya tempat business/security rule.

### apps/api
- auth
- authorization
- database
- orchestration
- file storage
- AI calls
- approval/finalization
- audit
- export

### packages/calc
Pure calculation only:

- weight
- cumulative progress
- remaining volume
- daily allocation
- material need
- deviation
- rounding rules

### packages/shared
- enums
- shared types
- validation contracts
- DTO/schema shared jika memang berguna

### packages/config
- shared TypeScript/ESLint config bila dibutuhkan

## 4. Decimal Strategy

Semua nilai kritis diperlakukan sebagai decimal.

Database:
- DECIMAL

API:
- serialisasi decimal sebagai string

Calculation:
- gunakan decimal library atau tipe decimal dari layer yang konsisten

Hindari business math kritis menggunakan JS `number`.

## 5. Storage

```text
storage/
  projects/{projectId}/
    documents/
      contract/
      mc0/
      addendum/
      ahsp/
      schedule/
    ai/
    reports/
  exports/
  temp/
```

Nama file fisik gunakan UUID/random safe name.

Simpan:
- original name
- stored name
- MIME
- size
- SHA-256
- uploader
- timestamp

## 6. Authentication

- server-side session
- HTTP-only cookie
- expiry
- revoke
- password hash
- role per project

## 7. Authorization

Role diverifikasi backend.

Rule penting:
- reviewer tidak finalisasi laporan miliknya sendiri
- hanya role berwenang aktivasi baseline
- hanya role berwenang reopen final report
- hanya admin/authorized user approve AI extraction

## 8. Transactions

Gunakan transaksi untuk operasi multi-step:

- approve extraction -> create RAB official
- activate baseline
- finalize report -> snapshot + audit
- reopen report + audit

## 9. Snapshot Architecture

Draft/review menggunakan data live.

Finalization:

```text
live validated data
-> canonical report payload
-> snapshot JSON
-> checksum
-> FINAL
```

Export final selalu dari snapshot.

## 10. Failure Isolation

Jika 9router mati:
- aplikasi proyek/progress/report tetap berjalan
- hanya AI extraction unavailable

Jika export gagal:
- report snapshot tetap aman
- export dapat diulang

Jika storage file gagal:
- transaksi metadata tidak boleh mengklaim file tersimpan sukses
