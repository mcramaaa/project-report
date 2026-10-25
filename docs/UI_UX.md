# UI / UX Flow

## Arah visual aplikasi

Acuan: OLMAT v2 Backoffice (`olmat-v2/olmat-backoffice/docs/STYLE-GUIDE.md`
dan `src/styles/tokens.css` pada workspace referensi). Implementasi mandiri
di aplikasi ini; build tidak bergantung pada direktori OLMAT.

- Latar ice blue `#f5f8fc`, panel putih, teks slate, aksen biru `#2563eb`.
- Border tipis, radius 10–18px, shadow ringan; font sistem tanpa unduhan font.
- Sidebar terang pada desktop (mulai 1024px), topbar dengan breadcrumb dan akun.
- Pada mobile: drawer native dialog, navigasi bawah, tabel user/anggota menjadi
  kartu berlabel di bawah 768px. Focus keyboard, skip link, dan reduced motion tersedia.
- Login dua kolom pada desktop dan satu kolom pada mobile, dengan toggle password.
- Komponen tombol, input, badge, alert, loading, empty state memakai token yang sama.
- Daftar proyek menggunakan kartu dari data API; tidak menampilkan progres/statistik
  yang belum tersedia. Navigasi hanya menuju fitur yang sudah diimplementasikan.
- Halaman profil memisahkan identitas akun dan penggantian password.
- Visibilitas menu mengikuti akun; authorization tetap diperiksa di backend.

## 1. Sidebar

```text
Dashboard

Proyek
  Informasi Proyek
  Dokumen
  Tim Proyek

RAB & Baseline
  Kontrak
  MC-0
  Addendum
  Perbandingan
  Riwayat Baseline

AHSP
  Daftar Analisa
  Komponen

Jadwal
  Time Schedule
  Kurva S

Progres
  Mingguan
  Harian
  Sumber Daya

Laporan
  Harian
  Mingguan
  Bulanan / 4 Minggu
  Kurva S

Finalisasi
Audit Log
Pengaturan
```

## 1a. Akun & Manajemen Akses (Milestone 2, pola olmat-backoffice)

| URL | Untuk | Isi |
|---|---|---|
| `/login` | publik | email + password; pesan gagal generik; info bila baru ganti password |
| `/` | user login | proyek yang dapat dibuka + role, cari & pagination (super admin: semua proyek); tombol "Proyek baru" dengan `projects.create` |
| `/projects/new` | `projects.create` | wizard pembuatan proyek (Milestone 3, §4) |
| `/projects/:projectId` | `project.read` | tab Informasi, Minggu & Periode, Tim; dengan `project.update`: ubah identitas, ubah jadwal, tutup/buka kembali |
| `/profile` | user login | data diri, ganti password (password lama wajib), setelah sukses diarahkan ke login |
| `/admin/users` | `users.read` | cari, pagination; dengan `users.manage`: buat, ubah, aktif/nonaktif; super admin: beri/cabut super admin |
| `/admin/users/:userId` | `assignments.read` | role administrasi user dan daftar proyek yang dapat diaksesnya; tambah/ubah/cabut akses proyek |
| `/admin/roles` | `roles.read` | kartu role proyek & role administrasi; tambah role |
| `/admin/roles/:roleId` | `roles.read` | identitas role, permission per modul dengan pencarian dan pilih grup |
| `/admin/projects` | `assignments.read` | daftar proyek (kode, nama), cari & pagination |
| `/admin/projects/:projectId/members` | `assignments.read` | anggota proyek; dengan `assignments.manage`: tambah, ubah role, cabut |

Aturan UX:

- menu "Manajemen akses" (Pengguna, Role & permission, Akses proyek) dan tab di halaman admin hanya tampil sesuai permission; backend tetap memeriksa
- setiap daftar memiliki loading, empty state, dan pesan error
- form menampilkan pesan validasi per field / pesan error dari server
- konfirmasi wajib sebelum menonaktifkan user, mencabut super admin/role/akses, dan menyimpan permission role
- pemberian akses proyek membutuhkan checklist "sudah memeriksa" dan menampilkan permission role yang dipilih
- kontrol akses diri sendiri dinonaktifkan untuk pemegang delegasi
- session tidak valid saat navigasi: diarahkan ke `/login`

## 2. Dashboard

Tampilkan:

- project aktif
- baseline aktif
- minggu berjalan
- hari kalender / masa kontrak
- progress rencana
- progress aktual
- deviasi
- Kurva S
- status laporan
- warning penting

## 3. Project List

Kolom:

- nama
- tahun
- baseline
- progress
- status

## 4. Create Project Wizard

Milestone 3. Satu kali simpan di akhir; data belum tersimpan sampai langkah terakhir dikirim.

### Step 1 Identitas
- kode proyek
- kegiatan
- sub kegiatan
- pekerjaan
- lokasi
- tahun anggaran

### Step 2 Kontrak
- kontraktor
- konsultan
- nomor
- tanggal
- nilai (decimal, maks. 2 desimal)

### Step 3 SPMK
- nomor
- tanggal
- tanggal mulai
- masa pelaksanaan (hari kalender)

Pratinjau sebelum simpan: tanggal selesai rencana, jumlah minggu, dan jumlah periode 4 minggu (dihitung dengan `packages/calc`, sama dengan backend).

Sistem generate minggu dan periode 4 minggu saat proyek disimpan.

### Detail Proyek

- tab Informasi: identitas, kontrak, SPMK, jadwal, status
- tab Minggu & Periode: tabel minggu (nomor, tanggal, jumlah hari, periode) dikelompokkan per periode B.n; minggu/periode pendek ditandai
- tab Tim: nama dan role anggota aktif (tanpa email); tautan ke Akses proyek bila punya `assignments.read`
- ubah jadwal menampilkan pratinjau minggu/periode baru dan wajib alasan
- tutup/buka kembali proyek wajib alasan dan konfirmasi; proyek CLOSED menampilkan badge dan form ubah dinonaktifkan

## 5. Documents

Tabel:
- jenis
- nama file
- tanggal
- status
- hasil AI
- action

## 6. Upload RAB

Pilih:
- Kontrak
- MC0
- Addendum

Jika Addendum:
- nomor
- nomor dokumen
- tanggal
- effective mode
- tanggal efektif bila exact-date

## 7. AI Extraction Status

Tampilkan progress:

- reading workbook
- detecting source sheet
- extracting rows
- validating
- comparing previous baseline

Ringkasan:
- total rows
- valid
- warning
- error

## 8. AI Review Split View

Kiri:
- file/sheet source
- source row

Kanan:
- parsed fields
- validation
- confidence
- edit controls

Filter:
- all
- warning
- error
- changed
- new
- removed
- uncertain

## 9. RAB Single Version

Tampilan familiar seperti Excel.

Columns selectable:
- no
- uraian
- volume
- satuan
- no analisa
- harga
- PPN
- harga+PPN
- subtotal
- bobot

Hierarchical rows dapat collapse/expand.

## 10. RAB Compare

```text
[Kontrak] vs [MC0]
```

atau versi lain.

Tampilkan:
- old
- new
- delta
- change status

## 11. Baseline History

Timeline:

```text
CONTRACT
-> MC0
-> ADDENDUM 1
-> ADDENDUM 2
```

Tampilkan effective period.

## 12. Weekly Progress Grid

Header:
- minggu
- periode
- baseline

Grid:
- pekerjaan
- baseline volume
- prev cumulative
- current week input
- cumulative
- %
- remaining

Input modes:
- weekly volume
- cumulative percent

UX penting:
- sticky headers
- sticky key columns
- keyboard navigation
- search
- filters
- only active
- only unfinished
- bulk save
- unsaved change warning

## 13. Daily Allocation

Tabel 7 hari:
- date
- day sequence
- factor
- volume

Method:
- daily factor
- schedule
- manual

Total harus sama dengan weekly volume.

## 14. Daily Report

Tabs:
- pekerjaan
- tenaga kerja
- material
- alat
- cuaca
- preview

Material/alat menunjukkan:
- calculated
- actual

## 15. Weekly Report

Tabs:
- rekap
- detail
- Kurva S
- preview

Ringkasan:
- planned previous
- planned current
- planned cumulative
- actual previous
- actual current
- actual cumulative
- deviation

## 16. 4-Week Report

Nama UI dapat tetap "Laporan Bulanan".

Subjudul:
- Periode 4 Minggu
- B.n
- date range

Tidak ada input progress baru.

## 17. Finalization

Checklist:
- no errors
- warnings acknowledged
- resource data complete
- review status

Buttons:
- return
- finalize

Reviewer own-input rule harus enforced backend.

## 18. Reopen

Manager:
- reason mandatory
- audit automatic

## 19. Audit Log

Filter:
- date
- user
- action
- entity

Detail:
- old
- new
- reason
