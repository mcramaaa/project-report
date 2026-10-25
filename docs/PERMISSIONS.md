# Permission Matrix

Sumber: PRD §2, D-026, D-033. Semua pemeriksaan dilakukan di backend (`apps/api`). Frontend hanya menyembunyikan navigasi/tombol untuk kenyamanan.

Dua lapis izin yang terpisah:

1. **System admin** (`users.is_system_admin`): administrasi global.
2. **Role proyek** (`project_users.role`, membership aktif): akses data satu proyek.

Tidak ada bypass universal. System admin tanpa membership tidak dapat membaca data proyek. Role tidak diperlakukan sebagai level berurutan; setiap izin dicantumkan eksplisit.

## 1. Izin System Admin

| Izin | System admin | User biasa | Status |
|---|---|---|---|
| Daftar/cari user | ✔ | ✘ | M2 |
| Buat user dengan password awal | ✔ | ✘ | M2 |
| Ubah nama/email user | ✔ | ✘ | M2 |
| Aktifkan/nonaktifkan user | ✔ (bukan system admin aktif terakhir) | ✘ | M2 |
| Beri/cabut system admin | ✔ (bukan system admin aktif terakhir) | ✘ | M2 |
| Daftar proyek (metadata minimum: id, kode, nama) | ✔ | ✘ | M2 |
| Kelola anggota & role proyek | ✔ | ✘ | M2 |
| Buat proyek (pembuat otomatis MANAGER) | ✔ | ✘ | M3 |
| Baca/ubah data proyek | hanya lewat role proyek | hanya lewat role proyek | — |

## 2. Izin Role Proyek

Kode izin dipakai di `packages/shared` (`PROJECT_ROLE_PERMISSIONS`). Baris berstatus "rencana" belum ada di kode; ditambahkan saat milestone terkait dan dikonfirmasi lebih dulu (OD-008).

| Izin | FILLER | REVIEWER | MANAGER | ADMIN | Status |
|---|---|---|---|---|---|
| `project.read` — baca identitas proyek | ✔ | ✔ | ✔ | ✔ | M2 |
| `progress.input` — input progres | ✔ | | | | rencana M9 |
| `dailyReport.edit` — input/koreksi laporan harian | ✔ | | | | rencana M11 |
| `report.review` — memeriksa laporan | | ✔ | ✔ | | rencana M11–13 |
| `report.finalize` — finalisasi laporan ¹ | | ✔ | ✔ | | rencana M13 |
| `baseline.activate` — aktivasi baseline | | | ✔ | | rencana M6 |
| `addendum.manage` — pengelolaan Addendum | | | ✔ | | rencana M6 |
| `report.reopen` — reopen laporan final (alasan wajib) | | | ✔ | | rencana M13 |
| `presentation.view` — preview/presentasi | | | ✔ | | rencana M15 |
| `document.upload` — upload dokumen | | | | ✔ | rencana M5 |
| `aiExtraction.review` — review & approve ekstraksi AI | | | | ✔ | rencana M5 |

¹ Reviewer/manager **tidak boleh memfinalisasi laporan yang ia input sendiri**. Aturan ini wajib diimplementasikan di backend dan diuji saat fitur laporan dibuat (Milestone 11–13), lihat `docs/ACCEPTANCE_TESTS.md` bagian I.

## 3. Respons Penolakan

| Kondisi | HTTP |
|---|---|
| Tidak ada session / session kedaluwarsa / dicabut / user nonaktif | 401 |
| Request mengubah data tanpa `Origin` yang sesuai | 403 |
| Endpoint `/api/admin/*` oleh non-system-admin | 403 |
| Proyek tanpa membership aktif (termasuk system admin) | 404 |
| Membership aktif tetapi role tidak memiliki izin | 403 |

## 4. Audit Action

| Action | Kapan | Nilai yang dicatat |
|---|---|---|
| `CREATE_USER` | user dibuat (UI atau seed) | nama, email, status aktif, system admin |
| `UPDATE_USER` | nama/email berubah | field yang berubah, lama & baru |
| `ACTIVATE_USER` / `DEACTIVATE_USER` | status aktif berubah | `isActive` lama & baru |
| `GRANT_SYSTEM_ADMIN` / `REVOKE_SYSTEM_ADMIN` | hak system admin berubah | `isSystemAdmin` lama & baru |
| `ADD_PROJECT_MEMBER` | membership dibuat/diaktifkan ulang | user, role |
| `CHANGE_PROJECT_MEMBER_ROLE` | role berubah | role lama & baru |
| `REVOKE_PROJECT_MEMBER` | membership dicabut | user, role |
| `CHANGE_PASSWORD` | password diganti | tidak ada nilai |
| `REVOKE_SESSIONS` | session dicabut karena nonaktivasi/ganti password | jumlah session, penyebab |

Password, hash password, token, dan secret tidak pernah dicatat.
