# UI / UX Flow

## Arah visual aplikasi

Arah tema mengikuti OLMAT v2 Backoffice: kanvas ice blue, sidebar gradien biru
pucat dengan menu aktif glass, panel putih transparan, border tipis, dan
bayangan ringan. Warna utama aplikasi ini `#0263f5` (menggantikan biru OLMAT).
Implementasi memakai CSS dan komponen lokal; tidak mengimpor kode atau
dependency dari OLMAT.

- Tombol, input, badge, alert, loading, menu, dan focus state menggunakan token
  warna serta bayangan yang konsisten.
- Radius lembut 10–20px, font sistem tanpa unduhan font, dukungan
  `prefers-reduced-motion`, dan focus ring yang terlihat.
- Sidebar bergaya OLMAT pada desktop (mulai 1024px), dapat diminimalkan menjadi
  ikon dengan pilihan tersimpan; tooltip dan nama aksesibel tetap tersedia.
  Topbar memuat breadcrumb dan akun.
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
  MC-0 … MC-100
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
| `/projects/:projectId/imports` | `document.read` / `rabImport.review` | dokumen (upload .xlsx, unduh asli, kandidat sheet RAB), buat run impor (peran RAB/pendukung, sheet, versi tujuan), daftar run |
| `/projects/:projectId/imports/:importId` | `rabImport.review` / `rabImport.approve` | ringkasan & rekonsiliasi, issue, item dengan rantai rumus, kandidat, keputusan (analisa, harga langsung, harga analisa/override beralasan, pekerjaan permanen termasuk cari/pilih pekerjaan lama manual, D-067), review paket (ringkasan sumber/warisan/cocok/baru/masalah, konfirmasi usulan sekaligus, D-065), analisa terpakai & bukti rekonsiliasi, panggilan AI, approve/tolak/ulangi |
| `/projects/:projectId/rab/:versionId` | `rab.read` | Lihat RAB: tab Rekap RAB, Analisa, Bahan, Alat, dan Upah sesuai izin; konteks versi tetap (D-059) |
| `/projects/:projectId/rab/:versionId/analyses` | `ahsp.read` | analisa dan harga upah/bahan/alat paket versi yang sedang dilihat, pencarian, asal salinan |
| `/projects/:projectId/rab/:versionId/analyses/:analysisId` | `ahsp.read` | rincian analisa, D/E/harga, komponen dan tautan subanalisa dalam versi yang sama |
| `/admin/users` | `users.read` | cari, pagination; dengan `users.manage`: buat, ubah, aktif/nonaktif; super admin: beri/cabut super admin |
| `/admin/users/:userId` | `assignments.read` | role administrasi user dan daftar proyek yang dapat diaksesnya; tambah/ubah/cabut akses proyek |
| `/admin/roles` | `roles.read` | kartu role proyek & role administrasi; tambah role |
| `/admin/roles/:roleId` | `roles.read` | identitas role, permission per modul dengan pencarian dan pilih grup |
| `/admin/projects` | `assignments.read` | daftar proyek (kode, nama), cari & pagination |
| `/admin/projects/:projectId/members` | `assignments.read` | anggota proyek; dengan `assignments.manage`: tambah, ubah role, cabut |

Aturan UX:

- Analisa tidak menjadi tab detail proyek. Aksesnya melalui Lihat RAB → Analisa. URL lama dengan `version` tetap dapat dibuka melalui redirect; tanpa versi menuju daftar RAB untuk pemilihan eksplisit.
- Sidebar, drawer, dan navigasi bawah hanya memiliki satu menu "Pengguna" untuk manajemen akses. "Role & permission" dan "Akses proyek" dibuka melalui tab pada halaman admin, tanpa menu navigasi terpisah.
- Menu "Pengguna" tampil bila akun memiliki salah satu permission baca: `users.read`, `roles.read`, atau `assignments.read`. Tujuannya adalah tab pertama yang diizinkan dalam urutan tersebut; tab lain tetap mengikuti permission masing-masing. Menu tetap aktif pada seluruh halaman manajemen akses dan breadcrumb menunjukkan bagian yang sedang dibuka. Backend tetap memeriksa izin.
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
- MC (MC-0 … MC-100; nomor dipilih, boleh meloncat asal naik; D-069)

Jika MC:
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

Daftar analisa/AHSP proyek menggunakan satu daftar gabungan, meskipun analisa
di Excel sumber dipisah menjadi Struktur/Arsitektur/MEP. Disiplin dan dokumen
sumber tersedia untuk penelusuran/filter; pengguna tidak perlu berpindah
daftar analisa per disiplin. Pilihan analisa pada item RAB merujuk daftar ini
dengan versi yang sesuai. Hierarki kelompok pekerjaan pada grid RAB tetap ada.

Milestone 4 (D-040): `/projects/:id/rab` (daftar versi, buat Kontrak/MC berikutnya) dan `/projects/:id/rab/:versionId` (grid). Draft dapat diedit per baris (tambah baris/sub-baris, ubah, hapus, naik/turun, pindah induk) oleh `rab.edit`; panel validasi menampilkan error/warning; approve oleh `rab.approve` dengan konfirmasi warning; discard wajib alasan. Header tabel dan kolom No/Uraian sticky; pilihan kolom tersimpan per browser.

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

Milestone 4: `/projects/:id/rab/compare?base=&target=`; filter perubahan (semua/berubah/baru/dihapus). Volume, harga, dan jumlah versi target serta Δ volume dan Δ jumlah berwarna hijau dengan ▲ bila naik dan merah dengan ▼ bila turun (teks "naik"/"turun" untuk pembaca layar); baris baru/dihapus tidak diwarnai. Volume tiap versi dan Δ volume tampil 2 desimal (Decimal HALF_UP, mis. 561,972461257442 → 561,97), sama seperti jumlah; panah/warna dan tanda Δ mengikuti nilai pada presisi tampilan, sehingga selisih yang hilang setelah pembulatan tidak diberi panah dan tampil 0,00 tanpa tanda. Hanya format tampilan: presisi data, kalkulasi, dan status perubahan item tidak berubah; nilai lengkap tetap dapat ditelusuri lewat tautan ke item versi sumber.

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
-> MC-0
-> MC-1
-> MC-2 … MC-100
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

D-060: tab Bahan (`.../materials`), Alat (`.../equipment`), dan Upah
(`.../labor`) menampilkan harga terpisah, pencarian, satuan dan sumber dalam
versi terpilih. Detail analisa memakai tabel lembar kerja A/B/C, subtotal,
D/E/F dan pembulatan; di layar kecil tabel dapat digeser horizontal.

## D-061 Asal nilai dan penyempurnaan seluruh halaman

Nilai bertanda garis bawah putus-putus membuka dialog Asal nilai: presisi
lengkap, formula, operand dan tautan lanjut. Escape/tombol tutup mengembalikan
fokus; tautan tujuan membawa konteks versi dan menyorot baris. Input manual
dan sumber hilang dijelaskan jujur. Pratinjau sumber berada di
`/projects/:projectId/documents/:documentId?sheet=&cell=` dan tetap berizin.
Desain memperbesar teks tabel/form, memperjelas hirarki panel dan aksi,
breadcrumb kontekstual, state memuat/gagal, target sentuh serta focus keyboard.

D-062: halaman satu versi RAB beserta rincian hanya memakai satu baris tab
paket. Di atasnya ada tautan teks ke proyek dan daftar versi (sesuai izin),
bukan baris tab proyek tambahan. Detail analisa tetap punya tautan kembali
ke daftar analisa dalam versi yang sama.

D-064: garis putus-putus dan dialog Asal nilai khusus angka RAB dan
pendukungnya. Informasi proyek dan kalender/pratinjau jadwal memakai teks
biasa; tombol ubah dan navigasi normal tetap dipertahankan.

## Workspace RAB: penataan aksi

- Aksi persetujuan draft/koreksi ditampilkan tepat setelah ringkasan pemeriksaan,
  sebelum tabel panjang, agar pengguna melihat status dan langkah berikutnya.
- Toolbar tabel memisahkan pencarian, pengaturan tampilan, dan aksi utama
  `Tambah bagian / pekerjaan`.
- Semua aksi per baris berada di dropdown tombol `⋯`, termasuk `Ubah`,
  `Tambah sub-bagian` atau `Ganti WI` sesuai konteks, dan `Hapus baris`.
  Hapus tetap berwarna danger dan meminta konfirmasi.
- Saat versi editable, pegangan `☰` di kiri nomor baris dapat diseret untuk
  mengurutkan saudara dalam kelompok/induk yang sama. Drop ditandai garis biru.
  Urutan langsung tersimpan saat dilepas, juga pada versi yang sedang
  dikoreksi (tanpa alasan, tanpa tombol simpan).
  Perpindahan lintas induk tetap dilakukan lewat `Ubah`; urutan baris diubah
  dengan drag melalui pegangan tersebut.
- Tombol `Koreksi` pada harga dasar dan komponen analisa memakai gaya sekunder
  berukuran ringkas. Tombol simpan tetap aksi utama; pada REOPENED alasan wajib
  dan pesan validasi tampil di dekat form.
- Pada layar kecil toolbar membungkus dengan urutan yang sama, tombol utama
  memenuhi lebar area, dan aksi baris tidak menutupi uraian pekerjaan.

### Penataan ulang 2026-10-28 (Rekap, Analisa, Bahan, Alat, Upah)

- **Satu header untuk semua tab:** judul halaman adalah versi (`RAB MC-0` +
  badge status; "Dibuka untuk koreksi" berwarna amber). Kode dan nama proyek
  tampil sebagai konteks di atasnya, dan "Semua versi RAB" menjadi tautan
  kembali. Tab langsung di bawah judul.
- **Rekap:** kartu ringkasan dokumen berisi nomor/tanggal dokumen (berupa form
  saat draft/koreksi), tombol "Riwayat & snapshot" dan "Buka untuk koreksi" di
  kanan, serta tiga total dalam satu strip.
  - Pemeriksaan dan Approval berdampingan; daftar peringatan dilipat bila lebih
    dari 3.
  - Petunjuk "klik nilai bergaris" pindah ke toolbar.
  - Kolom aksi `⋯` menempel di kanan tabel (desktop).
- **Daftar Analisa/Bahan/Alat/Upah:** judul + jumlah + keterangan paket di kiri,
  pencarian (ikon, tombol "Cari") di kanan.
  - Angka rata kanan, satuan analisa sebagai "per m3".
  - Sumber Excel menjadi tautan pratinjau.
  - Di HP baris menjadi kartu dua kolom (nama penuh di atas, harga di kanan),
    sekitar separuh tinggi kartu lama.
- **Koreksi langsung di sel (tanpa dialog untuk input):**
  - Nilai sumber yang boleh dikoreksi diberi ikon pensil di sampingnya:
    - harga dasar Bahan/Alat/Upah;
    - koefisien komponen dan harga komponen manual;
    - persentase overhead (baris E) dan pembulatan (baris terakhir).
  - Klik pensil mengubah nilai itu menjadi input di kolomnya sendiri, dengan
    tombol ikon ✓ (Enter) dan ✕ (Esc) di baris yang sama, setinggi 28 px.
  - Saat REOPENED ada satu baris tambahan untuk alasan, berisi alasan terakhir
    di halaman itu. Alasan kosong ditandai dengan border merah, tanpa baris
    pesan.
  - "Sekarang …" ada di tooltip input dan dibacakan pembaca layar.
  - Baris tabel hanya bertambah ±10–30 px saat diedit; draft tidak bertambah.
  - Satuan harga dasar (kolom Satuan di Bahan/Alat/Upah) dan faktor konversi
    komponen ("÷ 8 → /OJ" di bawah harga komponen) juga memakai pensil. Faktor
    ditulis `/8`, `÷ 4`, atau `×2`; kosong berarti tanpa konversi.
  - Harga komponen yang tertaut harga dasar tidak diedit di analisa. Di bawah
    harganya tampil "dasar Rp X/satuan", ditambah "÷ 8 → /OJ" bila sumber
    memakai faktor. Tautannya menuju harga dasar, yang punya pensil sendiri.
  - Tanda amber untuk satuan yang tidak konsisten:
    - "satuan beda, tanpa konversi": satuan harga dasar ≠ satuan komponen dan
      sumber tidak membagi/mengalikan;
    - "satuan tertulis sama": satuan sama tetapi sumber membagi/mengalikan,
      kemungkinan satuan harga dasar sebenarnya lain (per batang 4 m).
    - Konversi tidak pernah ditebak dari nama satuan.
  - Konfirmasi yang butuh alasan juga inline:
    - "Buka untuk koreksi" di dalam kartu ringkasan.
    - Hapus baris di bawah baris yang dihapus.
    - Override harga sumber di review impor, di bawah tombolnya.
  - Dialog hanya dipakai untuk melihat (asal nilai, menu akun, navigasi HP).
  - Form ubah baris RAB tetap di baris itu dan menggulir dirinya agar tombol
    Simpan terlihat.
  - Harga yang mengikuti analisa ditampilkan sebagai field hanya-baca (garis
    putus-putus).

### Penanda status nilai (2026-10-28)

- Badge teks "koreksi manual", "dihitung ulang", "override", dan "langsung"
  diganti ikon bulat kecil di samping nilai:
  - pensil merah: koreksi manual;
  - pensil biru: dihitung ulang dari koreksi sumber;
  - info amber: harga override atau harga langsung.
- Penjelasannya muncul sebagai tooltip saat kursor diarahkan atau saat difokus
  dengan keyboard (Esc menutup).
  - Isinya satu baris per koreksi (jenis, oleh siapa, tanggal, alasan),
    ditambah satu catatan "bukan angka asli Excel".
  - Tooltip digambar di lapisan tetap sehingga tidak terpotong tabel yang
    di-scroll.
  - Pembaca layar membaca teks yang sama.
