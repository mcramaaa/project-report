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
| `project.read` | PROJECT | Proyek | baca identitas proyek |

Rencana (ditambahkan saat milestone terkait, default role sistem dikonfirmasi lebih dulu, OD-008): `progress.input` (M9), `dailyReport.edit` (M11), `report.review`, `report.finalize`¹ (M11–13), `baseline.activate`, `addendum.manage` (M6), `report.reopen` (M13), `presentation.view` (M15), `document.upload`, `aiExtraction.review` (M5).

¹ **Reviewer tidak boleh memfinalisasi laporan yang ia input sendiri**, termasuk super admin. Aturan domain ini diimplementasikan dan diuji di backend saat fitur laporan dibuat (`docs/ACCEPTANCE_TESTS.md` bagian I).

## 3. Role Sistem Bawaan

FILLER, REVIEWER, MANAGER, ADMIN (scope `PROJECT`, dari PRD §2). Kode, scope, dan status aktif terkunci; nama, deskripsi, dan permission dapat diubah. Default permission: `project.read`.

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
| `POST/PATCH/DELETE /admin/projects/:id/members` | `assignments.manage` (bukan diri sendiri) |
| `GET /projects` | login; super admin melihat semua proyek |
| `GET /projects/:id` | `project.read` di proyek itu, atau super admin |

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
| `CHANGE_PASSWORD` | password diganti | tidak ada nilai |
| `REVOKE_SESSIONS` | session dicabut karena nonaktivasi/ganti password | jumlah session, penyebab |

Password, hash password, token, dan secret tidak pernah dicatat.
