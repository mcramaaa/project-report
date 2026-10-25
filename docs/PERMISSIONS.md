# Role & Permission

Sumber: PRD §2, D-035 (pola `olmat-backoffice`), D-033. Semua pemeriksaan di backend (`apps/api`). Frontend hanya menyembunyikan navigasi/tombol.

Prinsip: **permission ditentukan per kemampuan, bukan nama role.** Role adalah kumpulan permission yang dapat diatur.

## 1. Lapisan Akses

| Lapisan | Disimpan di | Cakupan | Diatur oleh |
|---|---|---|---|
| Super admin | `users.is_system_admin` | semua permission, global + semua proyek | super admin |
| Role administrasi | `user_global_roles` → role `GLOBAL` | permission global (delegasi) | super admin |
| Role proyek | `project_users.role_id` → role `PROJECT` | permission proyek, satu proyek | super admin / `assignments.manage` |

- Satu user dapat memiliki beberapa role administrasi, dan satu role proyek per proyek.
- Role nonaktif dan penugasan yang dicabut tidak memberi permission.
- Tidak ada penugasan "semua proyek"; akses ke semua proyek hanya milik super admin.
- Permission dibaca dari database setiap request.

## 2. Katalog Permission

Didefinisikan di `packages/shared` (`PERMISSIONS`). Hanya permission yang sudah ditegakkan backend yang masuk katalog.

| Kode | Scope | Modul | Arti |
|---|---|---|---|
| `users.read` | GLOBAL | Pengguna | lihat daftar & detail user |
| `users.manage` | GLOBAL | Pengguna | buat, ubah, aktif/nonaktif user selain super admin |
| `roles.read` | GLOBAL | Role & permission | lihat role & permission |
| `roles.manage` | GLOBAL | Role & permission | buat role proyek, atur permission role proyek |
| `assignments.read` | GLOBAL | Akses proyek | lihat proyek (metadata minimum), anggota, akses per user |
| `assignments.manage` | GLOBAL | Akses proyek | tambah/ubah role/cabut anggota proyek, kecuali diri sendiri |
| `projects.create` | GLOBAL | Proyek | membuat proyek; pembuat menjadi MANAGER (D-039) |
| `project.read` | PROJECT | Proyek | baca identitas, minggu, periode, tim proyek |
| `project.update` | PROJECT | Proyek | ubah identitas, jadwal, tutup/buka kembali proyek |
| `rab.read` | PROJECT | RAB | lihat versi RAB, grid, perbandingan (D-041) |
| `rab.edit` | PROJECT | RAB | buat/ubah/discard draft RAB |
| `rab.approve` | PROJECT | RAB | approve draft RAB |
| `document.read` | PROJECT | Dokumen | lihat & unduh dokumen proyek (D-049) |
| `document.upload` | PROJECT | Dokumen | upload dokumen |
| `rabImport.review` | PROJECT | Impor RAB | buat run impor, retry, catat keputusan reviewer |
| `rabImport.approve` | PROJECT | Impor RAB | approve/reject impor → analisa/harga resmi + RAB DRAFT |
| `ahsp.read` | PROJECT | AHSP | lihat daftar analisa, komponen, harga |

Rencana (ditambahkan saat milestone terkait; `rab.*` sudah ditambahkan di M4, default role sistem dikonfirmasi lebih dulu, OD-008): `progress.input` (M9), `dailyReport.edit` (M11), `report.review`, `report.finalize`¹ (M11–13), `baseline.activate`, `addendum.manage` (M6), `report.reopen` (M13), `presentation.view` (M15), `document.upload`, `aiExtraction.review` (M5).

¹ **Reviewer tidak boleh memfinalisasi laporan yang ia input sendiri**, termasuk super admin. Aturan domain ini diimplementasikan dan diuji di backend saat fitur laporan dibuat (`docs/ACCEPTANCE_TESTS.md` bagian I).

## 3. Role Sistem Bawaan

FILLER, REVIEWER, MANAGER, ADMIN (scope `PROJECT`, dari PRD §2). Kode, scope, dan status aktif terkunci; nama, deskripsi, dan permission dapat diubah.

| Role | Default permission |
|---|---|
| FILLER, REVIEWER | `project.read`, `rab.read`, `ahsp.read` |
| ADMIN | `project.read`, `rab.read`, `rab.edit`, `ahsp.read`, `document.read`, `document.upload`, `rabImport.review` |
| MANAGER | `project.read`, `project.update`, `rab.read`, `rab.edit`, `rab.approve`, `ahsp.read`, `document.read`, `document.upload`, `rabImport.review`, `rabImport.approve` |

Pembuat proyek menjadi MANAGER. Bila permission MANAGER diubah sehingga tidak memiliki `project.read` atau `project.update`, pembuatan proyek ditolak dengan pesan konfigurasi; permission tidak diperbaiki otomatis (D-039).

Role tambahan (proyek atau administrasi) dapat dibuat. Role tidak dihapus; nonaktifkan bila tidak dipakai.

## 4. Batasan Anti-Eskalasi

Hanya super admin yang dapat:

- memberi/mencabut status super admin
- membuat, mengubah, atau menonaktifkan akun super admin
- membuat/mengubah role `GLOBAL` dan permission-nya
- memberi/mencabut role administrasi ke user

Pemegang `assignments.manage` tidak dapat menambah, mengubah, atau mencabut akses proyeknya sendiri. Pemegang permission administrasi tidak otomatis dapat membaca data proyek.

Risiko yang diterima: pemegang `roles.manage` dapat mengubah permission role proyek yang juga ia pegang. Semua perubahan diaudit.

Super admin aktif terakhir tidak dapat dinonaktifkan atau dicabut (D-029).

## 5. Endpoint dan Permission

| Endpoint | Syarat |
|---|---|
| `GET /admin/users`, `GET /admin/users/:id` | `users.read` |
| `POST /admin/users`, `PATCH /admin/users/:id`, `activate`, `deactivate` | `users.manage` (+ batasan §4) |
| `grant-system-admin`, `revoke-system-admin` | super admin |
| `GET /admin/permissions`, `GET /admin/roles/:id` | `roles.read` |
| `GET /admin/roles` | `roles.read` atau `assignments.read` |
| `POST/PATCH /admin/roles`, `PUT /admin/roles/:id/permissions` | `roles.manage`; role `GLOBAL` hanya super admin |
| `GET /admin/users/:id/access` | `assignments.read` |
| `POST/DELETE /admin/users/:id/global-roles` | super admin |
| `GET /admin/projects`, `GET /admin/projects/:id/members` | `assignments.read` |
| `GET /admin/projects/:id/member-candidates` | `assignments.manage` (metadata minimum: id, nama, email user aktif) |
| `POST/PATCH/DELETE /admin/projects/:id/members` | `assignments.manage` (bukan diri sendiri) |
| `GET /projects` | login; hanya proyek dengan `project.read` (konsisten dengan detail); super admin melihat semua proyek |
| `POST /projects` | `projects.create` |
| `GET /projects/:id`, `/weeks`, `/report-periods`, `/team` | `project.read` di proyek itu, atau super admin |
| `PATCH /projects/:id`, `PUT /schedule`, `POST /close`, `POST /reopen` | `project.update` di proyek itu, atau super admin |
| `GET /projects/:id/rab-versions…` (daftar, detail, compare) | `rab.read` |
| `POST/PATCH/DELETE /projects/:id/rab-versions…` (draft, baris, discard) | `rab.edit` |
| `POST /projects/:id/rab-versions/:vid/approve` | `rab.approve` |
| `GET /projects/:id/documents…` / `POST /projects/:id/documents` | `document.read` / `document.upload` |
| `GET /projects/:id/rab-imports…` | `rabImport.review` atau `rabImport.approve` |
| `POST /projects/:id/rab-imports`, `…/decisions`, `…/retry` | `rabImport.review` |
| `POST /projects/:id/rab-imports/:iid/approve`, `…/reject` | `rabImport.approve` |
| `GET /projects/:id/analyses…`, `GET /projects/:id/price-lists…` | `ahsp.read` |

## 6. Respons Penolakan

| Kondisi | HTTP |
|---|---|
| Tidak ada session / kedaluwarsa / dicabut / user nonaktif | 401 |
| Request mengubah data tanpa `Origin` yang sesuai | 403 |
| Tidak memiliki permission global yang disyaratkan | 403 |
| Proyek tanpa membership aktif (bukan super admin) | 404 |
| Membership aktif tetapi role tidak memberi permission / role nonaktif | 403 |
| Aksi khusus super admin oleh pemegang delegasi | 403 |

## 7. Audit Action

| Action | Kapan | Nilai yang dicatat |
|---|---|---|
| `CREATE_USER` | user dibuat (UI atau seed) | nama, email, status aktif, super admin |
| `UPDATE_USER` | nama/email berubah | field yang berubah, lama & baru |
| `ACTIVATE_USER` / `DEACTIVATE_USER` | status aktif berubah | `isActive` lama & baru |
| `GRANT_SYSTEM_ADMIN` / `REVOKE_SYSTEM_ADMIN` | status super admin berubah | `isSystemAdmin` lama & baru |
| `CREATE_ROLE` / `UPDATE_ROLE` | role dibuat / identitas berubah | kode, nama, scope; field yang berubah |
| `UPDATE_ROLE_PERMISSIONS` | permission role diganti | daftar kode lama & baru |
| `GRANT_GLOBAL_ROLE` / `REVOKE_GLOBAL_ROLE` | role administrasi diberikan/dicabut | role id & kode |
| `ADD_PROJECT_MEMBER` | akses proyek diberikan/diaktifkan ulang | user, role id & kode |
| `CHANGE_PROJECT_MEMBER_ROLE` | role proyek berubah | role lama & baru |
| `REVOKE_PROJECT_MEMBER` | akses proyek dicabut | user, role |
| `CREATE_PROJECT` | proyek dibuat | identitas, jadwal, tanggal selesai, jumlah minggu/periode, MANAGER pembuat |
| `UPDATE_PROJECT` | identitas berubah | field yang berubah, lama & baru |
| `CHANGE_PROJECT_SCHEDULE` | tanggal mulai/durasi berubah | mulai, durasi, tanggal selesai, jumlah minggu/periode lama & baru |
| `CLOSE_PROJECT` / `REOPEN_PROJECT` | status proyek berubah | status lama & baru (alasan wajib) |
| `CREATE_RAB_VERSION` / `UPDATE_RAB_VERSION` | versi RAB dibuat (jenis, revisi, versi asal) / dokumen diubah | jenis, revisi, nomor/tanggal dokumen |
| `APPROVE_RAB_VERSION` | draft disetujui | total sebelum PPN, PPN, total, jumlah ITEM, warning yang dikonfirmasi |
| `UPLOAD_DOCUMENT` | dokumen di-upload | nama file, ukuran, sha256 |
| `CREATE_RAB_IMPORT` / `RETRY_RAB_IMPORT` | run impor dibuat / diulang | versi tujuan, dokumen, run sebelumnya |
| `DECIDE_RAB_IMPORT_ROW` | keputusan reviewer | baris, jenis, nilai, alasan |
| `APPROVE_RAB_IMPORT` / `REJECT_RAB_IMPORT` | impor di-approve / ditolak | versi RAB & daftar harga hasil, jumlah analisa/komponen; alasan |
| `DISCARD_RAB_VERSION` | draft dibatalkan | status lama & baru (alasan wajib) |
| `UPLOAD_DOCUMENT` | dokumen di-upload | nama file, ukuran, sha256 |
| `CREATE_RAB_IMPORT` / `RETRY_RAB_IMPORT` | run impor dibuat / diulang | versi tujuan, dokumen, run sebelumnya |
| `DECIDE_RAB_IMPORT_ROW` | keputusan reviewer | baris, jenis, nilai, alasan |
| `APPROVE_RAB_IMPORT` / `REJECT_RAB_IMPORT` | impor di-approve / ditolak | versi RAB & daftar harga hasil, jumlah analisa/komponen; alasan |
| `CHANGE_PASSWORD` | password diganti | tidak ada nilai |
| `REVOKE_SESSIONS` | session dicabut karena nonaktivasi/ganti password | jumlah session, penyebab |

Password, hash password, token, dan secret tidak pernah dicatat.
