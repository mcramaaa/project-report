# Acceptance Tests

Gunakan ini sebagai checklist saat vibe coding.

## 0. Database & Seed (Milestone 1)

- [x] migration berjalan di database bersih
- [x] email unik secara case-insensitive (normalisasi + unique index)
- [x] token session disimpan sebagai hash
- [x] seed system admin dari environment
- [x] seed dijalankan ulang tidak mereset password akun yang ada
- [x] data development terpisah dari seed production

## 0b. Auth, User, Role (Milestone 2)

- [x] login benar berhasil; password salah, email tidak terdaftar, user nonaktif mendapat pesan yang sama
- [x] pembatasan percobaan login (per email; per IP menunggu Milestone 16, D-030)
- [x] session kedaluwarsa, logout, dan session dicabut ditolak
- [x] user nonaktif tidak bisa memakai session lama
- [x] ganti password: password lama wajib benar, semua session dicabut, password lama ditolak setelahnya
- [x] request mengubah data tanpa Origin yang sesuai ditolak
- [x] endpoint administrasi menolak user tanpa permission
- [x] super admin dapat membaca semua proyek tanpa membership (D-035)
- [x] pemegang permission administrasi tidak otomatis membaca data proyek
- [x] isolasi akses antarproyek
- [x] perubahan role dan pencabutan membership berlaku pada request berikutnya
- [x] membership ganda ditolak
- [x] super admin aktif terakhir tidak bisa dinonaktifkan/dicabut, termasuk pada request bersamaan
- [x] audit dibuat untuk aksi user/membership/password/session tanpa data rahasia
- [x] response user tidak berisi password hash/token
- [x] role sistem bawaan dengan `project.read`; kode/status terkunci
- [x] role baru dapat dibuat; kode unik
- [x] permission tidak dikenal atau beda scope ditolak
- [x] perubahan permission/status role berlaku pada request berikutnya
- [x] role nonaktif tidak dapat ditugaskan dan tidak memberi akses
- [x] delegasi: `users.*`, `roles.*`, `assignments.*` sesuai permission
- [x] delegasi tidak dapat menyentuh akun/status super admin, role administrasi, atau akses dirinya sendiri
- [x] pencabutan role administrasi berlaku pada request berikutnya
- [x] halaman akses user menampilkan role administrasi dan proyek yang dapat diakses
- [x] migration mempertahankan role membership yang sudah ada

## A. Project Setup

- [ ] project dapat dibuat
- [ ] tanggal selesai rencana dihitung dari start date + duration
- [ ] weeks dibuat sebagai blok 7 hari
- [ ] report periods dibuat sebagai blok 4 minggu
- [ ] periode terakhir dapat kurang dari 28 hari

## B. RAB Versioning

- [ ] CONTRACT dapat dibuat
- [ ] MC0 membuat versi baru
- [ ] ADDENDUM membuat versi baru
- [ ] versi lama tidak di-overwrite
- [ ] compare menunjukkan NEW/MODIFIED/REMOVED/UNCHANGED

## C. Work Item Identity

- [ ] item yang sama antar baseline tetap work_item_id yang sama
- [ ] item baru mendapat work_item_id baru
- [ ] item removed tidak menghapus histori progress

## D. Baseline Change

Scenario:

```text
M1 CONTRACT
M2 CONTRACT
M3 MC0
```

- [ ] M1/M2 tetap CONTRACT
- [ ] M3 memakai MC0
- [ ] cumulative actual tetap utuh

Scenario Addendum:

```text
M1-M10 existing baseline
M11 ADDENDUM 1
```

- [ ] M1-M10 tidak dihitung ulang
- [ ] M11 memakai Addendum

## E. Weekly Progress

- [ ] volume week input bekerja
- [ ] cumulative percentage input bekerja
- [ ] actual_volume disimpan
- [ ] cumulative tidak boleh melebihi baseline
- [ ] negative ditolak
- [ ] bulk save bekerja

## F. Daily Allocation

Example:
- weekly volume 14
- total factor 7
- one day factor 1.2

Expected:
- day volume = 2.4

- [ ] sum all daily == weekly volume setelah rounding
- [ ] remainder rounding masuk hari aktif terakhir
- [ ] all-zero factors ditolak
- [ ] manual allocation total mismatch ditolak

## G. Materials

- [ ] calculated = daily volume * AHSP coefficient
- [ ] actual dapat berbeda
- [ ] calculated value tidak hilang saat actual override

## H. Reports

### Daily
- [ ] pekerjaan
- [ ] tenaga kerja
- [ ] material
- [ ] alat
- [ ] cuaca
- [ ] preview

### Weekly
- [ ] planned
- [ ] actual
- [ ] cumulative
- [ ] deviation
- [ ] baseline yang digunakan

### 4-Week
- [ ] B1 uses M1-M4
- [ ] B2 uses M5-M8
- [ ] no new progress input
- [ ] last short period supported

## I. Finalization

- [ ] error menahan finalisasi
- [ ] warning membutuhkan catatan
- [ ] reviewer tidak finalisasi own entry (wajib diuji di backend saat fitur laporan dibuat; `docs/PERMISSIONS.md` catatan ¹)
- [ ] snapshot dibuat
- [ ] final export menggunakan snapshot
- [ ] Addendum setelah final tidak mengubah snapshot lama

## J. Reopen

- [ ] hanya role berwenang
- [ ] reason wajib
- [ ] audit log dibuat

## K. AI Extraction

- [ ] file asli disimpan
- [ ] extraction memiliki source locator
- [ ] invalid schema retry maksimal sesuai kebijakan
- [ ] failed extraction tidak menjadi official RAB
- [ ] review dapat edit hasil AI
- [ ] UNCERTAIN item match wajib human decision
- [ ] approval membuat official RAB transactionally
- [ ] audit dibuat

## L. Security

- [ ] auth cookie HTTP-only
- [ ] backend authorization
- [ ] secrets tidak di-client
- [ ] 9router tidak dipanggil dari browser
- [ ] upload MIME/size validation
