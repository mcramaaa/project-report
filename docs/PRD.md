# PRD - Aplikasi Laporan Progres Proyek

## 1. Visi

Pelaksana lapangan atau admin kantor cukup memasukkan data proyek dan progres secara terstruktur sekali. Dari data itu aplikasi menghasilkan laporan harian, mingguan, periode 4 minggu, Kurva S, ringkasan bahan, alat, serta output Excel/PDF/PPTX.

Prinsip:

- satu kali input, banyak laporan
- setiap angka dapat ditelusuri ke sumbernya
- output mengikuti format kantor
- AI membantu ekstraksi dokumen, manusia menyetujui
- histori proyek tidak ditulis ulang oleh perubahan kontrak/baseline

## 2. Pengguna

Izin mengikuti pola role & permission modular (D-035, detail di `docs/PERMISSIONS.md`):

- **Super admin** (`users.is_system_admin`): seluruh akses, global dan semua proyek.
- **Role administrasi** (global): delegasi pengelolaan user, role, dan akses proyek melalui permission.
- **Role proyek**: akses per proyek. Satu user satu role per proyek, dapat berbeda di proyek berbeda.
- Role adalah data yang dapat dibuat dan diatur permission-nya; permission ditentukan per kemampuan, bukan nama role.

Role proyek bawaan (role sistem, permission dapat diatur):


### FILLER
- input progres
- input/koreksi laporan harian
- mengelola draft

### REVIEWER
- memeriksa laporan
- finalisasi laporan
- tidak boleh finalisasi laporan yang ia input sendiri

### MANAGER
- semua fungsi reviewer
- aktivasi baseline
- reopen laporan final dengan alasan
- mengubah identitas, jadwal, dan status proyek (`project.update`)
- pengelolaan MC
- preview/presentasi

### ADMIN (role proyek)
- upload dokumen
- review hasil ekstraksi AI

Membuat proyek, pengelolaan user, dan konfigurasi sistem adalah wewenang super admin atau pemegang role administrasi yang sesuai.

### Editor RAB dan koreksi approved (D-068)

Role proyek `RAB_EDITOR` dapat membuka kembali versi approved yang sama
dengan alasan, snapshot lama immutable, audit dan approval ulang. Berlaku
hanya pada proyek yang ditugaskan. Nilai dikoreksi pada input asalnya
(volume, harga dasar, koefisien atau analisa); jumlah/bobot/total dihitung
ulang dalam paket itu saja. Versi lain dan dokumen asli tetap utuh.
Rancangan dan batasan: `docs/RAB_CORRECTIONS.md`. Ketentuan ini menggantikan
kunci permanen D-040 hanya melalui alur koreksi resmi tersebut.

### Akun User

- tidak ada pendaftaran publik; akun dibuat super admin atau pemegang `users.manage` dengan password awal
- user dinonaktifkan, tidak dihapus permanen
- super admin aktif terakhir tidak boleh dinonaktifkan atau dicabut haknya
- nonaktivasi dan perubahan password mencabut semua session user tersebut
- perubahan role, permission, dan penugasan berlaku pada request berikutnya
- pembuat proyek otomatis menjadi MANAGER proyek tersebut

## 3. Identitas Proyek

Data minimum:

- kegiatan
- sub kegiatan
- nama pekerjaan
- lokasi
- tahun anggaran
- kontraktor
- konsultan
- nomor/tanggal kontrak
- nomor/tanggal SPMK
- tanggal mulai
- masa pelaksanaan hari kalender
- tanggal selesai rencana
- nilai kontrak

Tanggal selesai rencana = tanggal mulai + masa pelaksanaan − 1 (hari mulai dihitung), dihitung dan tidak disimpan (D-036).

Status proyek: `ACTIVE` atau `CLOSED`. Proyek baru `ACTIVE`; tutup/buka kembali wajib alasan dan tercatat di audit. Proyek `CLOSED` tidak dapat diubah identitas maupun jadwalnya, tetapi tetap dapat dibaca. Proyek tidak dihapus.

Perubahan tanggal mulai/durasi wajib alasan dan membentuk ulang minggu/periode dalam satu transaksi; batasannya setelah ada data terkait di D-038.

## 4. Baseline dan Versi RAB

Satu proyek memiliki versi RAB:

1. CONTRACT
2. MC0
3. ADDENDUM 1
4. ADDENDUM 2
5. dst

Setiap versi disimpan terpisah dan tidak saling overwrite.

Milestone 4: versi berstatus DRAFT → APPROVED (terkunci) atau DISCARDED; MC (MC-0 … MC-100, D-069) dibuat sebagai salinan versi approved terakhir; rumus mengikuti workbook kantor (D-043): nilai per item tanpa pembulatan, total REAL COST 2 desimal dan DIBULATKAN ke rupiah. Aktivasi baseline di Milestone 6.

Setiap versi dapat mengubah:

- volume
- harga
- nilai pekerjaan
- bobot
- no analisa/AHSP
- item baru
- item dihapus
- hierarki pekerjaan

## 5. Baseline Aktif

Baseline aktif ditentukan berdasarkan periode/tanggal efektif.

Contoh:

```text
M1 -> CONTRACT
M2 -> CONTRACT
M3 -> MC0
...
M11 -> ADDENDUM 1
```

Perubahan baseline tidak mengubah progress atau laporan final sebelumnya.

## 6. Kasus Baseline Berubah Setelah Proyek Berjalan

Contoh:

- Beton CONTRACT: 100 m3
- Realisasi M1-M2: 30 m3
- MC0/Addendum baru: 120 m3

Maka:

- realisasi lama tetap 30 m3
- baseline baru 120 m3
- progress terhadap baseline baru 25%
- sisa 90 m3

Jika baseline baru lebih kecil daripada realisasi aktual, sistem memberi error/warning sesuai kebijakan dan tidak menghapus realisasi.

## 7. Tanggal Efektif MC

Addendum tidak lagi menjadi jenis versi (D-069); aturan tanggal efektifnya (D-020)
berlaku untuk setiap MC, MC-0 … MC-100. Setiap MC menyimpan:

- nomor
- tanggal dokumen
- tanggal efektif
- versi sebelumnya
- status

Mode aktivasi:

- NEXT_WEEK
- EXACT_DATE

Default yang disarankan: mulai minggu berikutnya.

Sistem tetap mendukung perubahan di tengah minggu melalui segment baseline harian bila memang diwajibkan dokumen resmi.

## 8. Struktur RAB Bertingkat

Jenis baris:

- SECTION
- SUBSECTION
- PARENT_ITEM
- ITEM
- SUBTOTAL
- TOTAL

Hierarki harus dipertahankan pada UI dan export.

## 9. Identitas Work Item Permanen

Pekerjaan trackable memiliki `work_item_id` permanen.

Contoh pekerjaan yang sama:

```text
work_item_id = 172
CONTRACT     39.39 m3
MC0          46.00 m3
ADDENDUM 1   50.00 m3
```

Progress selalu mengacu ke work item permanen, bukan ke baris versi RAB.

## 10. Status Perubahan Item Antar Versi

- UNCHANGED
- MODIFIED
- NEW
- REMOVED

UI perbandingan wajib menunjukkan perubahan antar baseline.

## 11. AHSP

Navigasi analisa berada di dalam halaman lihat versi RAB, bersama rekap dan
harga paketnya, bukan tab mandiri pada detail proyek (D-059). Konteks versi
RAB tetap saat membuka detail analisa/subanalisa dan kembali ke daftar.

Di sistem, analisa ditampilkan dan dikelola sebagai **satu daftar gabungan**
untuk **masing-masing versi RAB**, bukan satu daftar bersama seluruh proyek
(D-056). Penawaran/Kontrak, MC0, dan setiap Addendum memiliki rekap, analisa,
bahan, upah, alat, koefisien, dan harga sendiri. Penggabungan hanya lintas
Struktur/Arsitektur/MEP di dalam versi RAB yang sama. Bentuk sumber Excel
(analisa gabungan atau dipisah per disiplin/file/sheet) dinormalisasi ke daftar
yang sama. Asal disiplin/dokumen tetap metadata untuk penelusuran dan filter;
tidak menjadi pemisahan daftar wajib. Versi analisa dan referensi item tetap
dipertahankan, dan konflik kode/isi diselesaikan melalui review.

Analisa memiliki:

- nomor analisa
- uraian
- satuan
- versi analisa

Komponen:

- MATERIAL
- LABOR
- EQUIPMENT

Setiap komponen menyimpan:

- uraian
- satuan
- koefisien

Analisa dapat digunakan beberapa item dalam RAB yang sama. Analisa atau
harga dari RAB lain hanya boleh menjadi sumber kandidat/salinan yang
dikonfirmasi; hasilnya milik RAB tujuan, termasuk subanalisa dan harga yang
dibutuhkan, tanpa ketergantungan ke master RAB asal. Versi dan histori tetap
dipertahankan. Harga pada MC0/Addendum tidak mengubah Penawaran/Kontrak.

Jika dokumen MC0/Addendum tidak menyertakan analisa, gunakan analisa dari
versi RAB approved sebelumnya (D-058). Analisa dan dependency terpakainya
(subanalisa, bahan, upah, alat, koefisien, harga) disalin ke paket RAB tujuan,
bukan ditautkan ke master bersama. Asal salinan tetap terlacak. Jika dokumen
baru menyertakan analisa, gunakan sumber barunya; konflik atau selisih harga
dengan RAB tetap ditampilkan untuk review. Item baru tanpa analisa yang
dapat dipetakan tidak diberi analisa karangan.

Pada alur RAB berbasis analisa (D-046), harga satuan pekerjaan berasal dari
perhitungan komponen analisa: harga upah/bahan/alat dikalikan koefisiennya,
lalu dijumlahkan. Nilai pekerjaan berasal dari harga satuan analisa dikalikan
volume RAB; rekap mengagregasi nilai pekerjaan. PPN tetap mengikuti D-043 dan
tidak dikenakan dua kali. Overhead/profit atau komponen tambahan dari sumber
memerlukan verifikasi rumus (OD-012).

Hanya analisa yang dirujuk oleh item RAB yang diimpor, beserta komponen dan
harga yang diperlukan analisa tersebut. Analisa/upah/bahan/alat lain pada
workbook tidak diimpor sebagai data domain. File asli tetap disimpan lengkap.
Item bervolume 0 bukan otomatis tidak terpakai: penentuan pemakaian berdasarkan
referensi item yang termasuk versi RAB, bukan ambang volume. Penghilangan
referensi pada impor baru tidak menghapus data yang dipakai histori lama.

## 12. Minggu Proyek

Minggu bukan harus Senin-Minggu kalender.

Minggu proyek dibentuk dari tanggal mulai proyek dalam blok 7 hari.

Contoh:

```text
Tanggal mulai: 26 Mei
M1: 26 Mei - 1 Juni
M2: 2 Juni - 8 Juni
M3: 9 Juni - 15 Juni
```

Minggu terakhir berakhir pada tanggal selesai rencana dan boleh kurang dari 7 hari (D-037).

## 13. Input Progres Mingguan

Dua mode UI:

### VOLUME_WEEK
Pengguna menginput volume realisasi minggu ini.

### PERCENT_CUMULATIVE
Pengguna menginput persen kumulatif seperti kebiasaan Excel.

Database tetap menyimpan volume aktual sebagai fakta utama.

Tampilan:

- volume baseline
- progres sampai minggu lalu
- progres minggu ini
- kumulatif
- persen
- sisa

## 14. Validasi Progres

Error minimum:

- kumulatif melebihi baseline
- angka negatif
- work item tidak trackable
- minggu final dikoreksi tanpa reopen

## 15. Alokasi Harian

Metode:

- DAILY_FACTOR
- SCHEDULE
- MANUAL

Metode default menggunakan 7 faktor berdasarkan urutan hari dalam minggu proyek.

Contoh faktor workbook sumber:

```text
Hari 1  0.80
Hari 2  1.20
Hari 3  1.10
Hari 4  1.15
Hari 5  1.00
Hari 6  0.85
Hari 7  0.90
Total   7.00
```

Aturan:

```text
volume hari = volume minggu * faktor hari / total faktor
```

Setelah rounding, total harian wajib tepat sama dengan volume mingguan. Selisih pembulatan masuk hari aktif terakhir.

## 16. Laporan Harian

Satu laporan per tanggal.

Isi:

- proyek
- tanggal
- minggu
- pekerjaan hari itu
- tenaga kerja
- material
- alat
- cuaca
- catatan

Pekerjaan berasal dari daily allocation dan masih dapat dikoreksi sebelum final.

## 17. Material

Calculated material:

```text
daily work volume * AHSP material coefficient
```

Simpan dua nilai bila relevan:

- calculated_quantity
- actual_quantity

Pengguna dapat override aktual tanpa menghilangkan hasil hitung sistem.

## 18. Alat

Simpan:

- calculated quantity
- actual quantity
- unit
- override/catatan

## 19. Tenaga Kerja

Fase awal diinput manual.

Di fase berikutnya sistem dapat memberi rekomendasi dari AHSP, tetapi aktual tetap ditentukan pengguna.

## 20. Cuaca

Minimal mendukung:

- CLEAR
- CLOUDY
- DRIZZLE
- RAIN
- OTHER

Dapat menyimpan lebih dari satu kondisi per hari jika diperlukan.

## 21. Laporan Mingguan

Berisi:

- baseline minggu
- progres sampai minggu lalu
- progres minggu ini
- progres kumulatif
- bobot
- rencana
- aktual
- deviasi
- Kurva S
- detail item

## 22. Laporan "Bulanan"

Berdasarkan workbook kantor, laporan bulanan adalah periode 4 minggu / 28 hari sejak tanggal mulai proyek, bukan bulan kalender.

Contoh:

```text
B1 = M1-M4
B2 = M5-M8
B3 = M9-M12
```

Periode terakhir dapat kurang dari 28 hari dan berakhir pada tanggal selesai rencana.

Tidak ada input progres baru pada laporan periode ini. Data berasal dari minggu-minggu pembentuknya.

## 23. Kurva S

Time schedule harus versioned karena MC0/Addendum dapat memiliki schedule revisi.

Tampilkan:

- rencana mingguan
- rencana kumulatif
- aktual
- aktual kumulatif
- deviasi

## 24. Finalisasi

Status:

- DRAFT
- REVIEWED
- FINAL
- REOPENED

ERROR menahan finalisasi.

WARNING boleh disetujui dengan catatan.

Setelah final, buat snapshot immutable.

## 25. Reopen

Hanya role yang berwenang.

Alasan wajib.

Reopen dicatat di audit log.

## 26. Snapshot

Saat final, simpan data laporan final agar perubahan master/baseline berikutnya tidak mengubah laporan lama.

Export final menggunakan snapshot, bukan data live.

## 27. Audit Log

Catat minimal:

- waktu
- user
- action
- entity
- old value
- new value
- reason

Action penting:

- CREATE_PROJECT
- UPLOAD_DOCUMENT
- APPROVE_AI_EXTRACTION
- ACTIVATE_BASELINE
- UPDATE_PROGRESS
- FINALIZE_REPORT
- REOPEN_REPORT
- aksi user, super admin, role & permission, akses proyek, password, dan session (daftar di `docs/PERMISSIONS.md` §7)

Audit global (misalnya pengelolaan user) tidak memiliki project. Password, hash, token, dan secret tidak pernah dicatat.

## 28. Dokumen dan File

Simpan file asli:

- Kontrak
- RAB Kontrak
- MC (MC-0 … MC-100)
- AHSP
- Schedule
- template
- dokumen lain

Database menyimpan metadata dan path/hash.

File tidak disimpan sebagai blob besar di database.

## 29. AI Extraction

Admin upload Excel/PDF.

Upload mendukung paket dokumen proyek lengkap: RAB, rekap, analisa/AHSP,
daftar harga upah, bahan, dan alat. Struktur, Arsitektur, dan MEP dapat berada
di file atau sheet berbeda dan dikonsolidasikan menjadi satu RAB untuk satu
proyek dan satu versi baseline. Disiplin, hierarki, dan asal setiap baris tetap
terlacak; Kontrak, MC0, dan Addendum tidak digabung menjadi satu versi.

Pada sumber, analisa/AHSP dapat digabung atau dipisah per disiplin, termasuk
berada dalam file/sheet yang sama dengan RAB. **Hasil di sistem selalu satu
daftar analisa gabungan untuk RAB tujuan**, sesuai §11, terpisah dari daftar
versi RAB lain. Satu analisa yang telah
divalidasi dapat dirujuk beberapa item RAB; komponen analisanya tidak perlu
diduplikasi berdasarkan disiplin. Pemetaan referensi tetap melalui review.

Bila nama pekerjaan pada rekap berbeda dari nama analisa, telusuri formula
rekap (termasuk rantai referensi sheet perantara) untuk menemukan analisa yang
dipakai. Nama item RAB mengikuti rekap; nama analisa asli dan bukti referensi
tetap disimpan. Formula hilang/ambigu atau tidak dapat ditelusuri masuk review,
bukan dipetakan paksa berdasarkan kemiripan nama. Panduan impor tetap di
`docs/RAB_IMPORT_GUIDE.md` harus menjadi acuan prompt dan validasi backend.

Rekap dan rincian bukan dua sumber nilai untuk dijumlahkan bersama. Kode item
atau nomor analisa yang sama pada dokumen/disiplin berbeda tidak cukup untuk
menggabungkan data otomatis; konflik dan ketidakpastian ditinjau manusia.

M5 menerima dan menyimpan seluruh sumber serta draft terstrukturnya. Pengelolaan
AHSP resmi, komponen, harga referensi, dan pengaitan ke RAB diselesaikan pada M7;
upload lengkap tidak boleh mengklaim rincian AHSP sudah resmi bila baru draft.
Detail cakupan harga referensi dan approval-nya masih memerlukan keputusan
(OD-011). Perubahan harga sumber tidak otomatis mengubah RAB approved.

Flow wajib:

```text
file asli
-> parsing/preprocessing backend
-> AI extraction
-> structured JSON
-> schema validation
-> business validation
-> human review
-> approval
-> official RAB
```

AI tidak menjadi sumber kebenaran final.

## 30. AI Review

Run impor yang gagal, ditolak, atau masih menunggu review dapat dihapus dari
daftar untuk mengulang pemilihan dokumen/sheet (D-066). Penghapusan bersifat
soft delete dengan audit; file asli, draft, keputusan, dan rantai retry tetap
tersimpan. Run yang sedang diproses atau sudah menghasilkan data resmi tidak
dapat dihapus.

Layar review memperlihatkan:

- file/sumber asli
- hasil AI
- source sheet/row
- validation status
- confidence
- koreksi admin

Untuk MC0/Addendum, tampilkan perbandingan dengan baseline sebelumnya.

## 31. Item Matching Saat MC0/Addendum

Pertimbangkan:

- kode/nomor
- parent
- uraian
- analisa
- satuan
- posisi/hierarki
- bantuan AI

Hasil:

- MATCHED
- NEW
- UNCERTAIN
- REMOVED

UNCERTAIN wajib diputuskan manusia.

Pasangan pekerjaan (D-067): uraian yang hanya berbeda tanda baca berulang
(mis. "Pas.." vs "Pas.") menjadi kandidat/usulan hanya bila kelompok, satuan,
dan kode analisa sama; angka/ukuran berbeda tidak disamakan. Reviewer selalu
dapat mencari dan memilih pekerjaan versi approved terakhir secara manual
selain "Pekerjaan baru"; backend menolak pekerjaan di luar versi itu atau yang
sudah dipilih baris lain.

Review paket (D-065): reviewer tidak perlu memutuskan ratusan item satu per
satu. Backend menyiapkan usulan dari versi RAB approved terakhir hanya bila
buktinya jelas dan tervalidasi ulang di backend: pekerjaan permanen (tepat satu
pasangan, jalur kelompok + uraian + satuan sama, tidak dipakai baris lain) dan
pewarisan analisa (sumber tidak memuat analisa sama sekali, rantai harga
berhenti di nilai dengan kode analisa atau harga literal dengan kode NO.
ANALISA eksplisit, tepat satu analisa paket sebelumnya
dengan kode, satuan, dan harga sama, dan tidak mengganti analisa pekerjaan
yang sama di versi sebelumnya). Layar review menampilkan ringkasan jumlah
analisa dari sumber, warisan, pekerjaan cocok, pekerjaan baru, dan masalah.
Reviewer mengonfirmasi seluruh usulan sekaligus; keputusan baru tercatat atas
nama reviewer saat konfirmasi itu. Konfirmasi ditolak bila versi dasar atau isi
usulan berubah sejak ditampilkan. Kandidat ambigu, usulan AI, item baru
tanpa pasangan, formula putus yang tidak terbukti, konflik harga/satuan, dan
perubahan analisa tetap diputuskan eksplisit per item. Approval impor dan
approval RAB tetap terpisah oleh manusia.

## 32. Output

- XLSX
- PDF
- PPTX

Excel tidak menggunakan external workbook link.

Output mengikuti pola kantor sedekat mungkin.

## 33. Keamanan

- login wajib, tanpa pendaftaran publik
- password di-hash (scrypt)
- session server-side di cookie HTTP-only; proteksi CSRF untuk request yang mengubah data
- pesan gagal login tidak membocorkan keberadaan akun
- server-side authorization
- session expiry/revoke
- rate limit login
- HTTPS untuk akses publik
- Cloudflare Tunnel
- 9router tidak dipublikasikan
- upload size limit
- MIME/extension whitelist
- audit login gagal bila dibutuhkan

## 34. Backup

Backup terjadwal:

- MySQL dump
- folder storage

Backup harus berada di lokasi berbeda dari disk utama.

## 35. Non-Functional

- deterministic calculation
- decimal-safe arithmetic
- export dapat dibuka tanpa aplikasi
- data dapat diekspor
- UI progres nyaman untuk puluhan/ratusan item
- keyboard navigation pada tabel penting
- tidak bergantung external workbook link

## 36. Acceptance High-Level

- input mingguan puluhan item cepat
- daily allocation jumlahnya tepat
- baseline change tidak mengubah histori
- Addendum baru tidak mengubah laporan final lama
- AI gagal validasi tidak dapat menjadi RAB official
- snapshot export konsisten
- Kurva S mengikuti versi schedule yang berlaku

### Rincian paket pada Lihat RAB (D-060)

Lima tab: Rekap RAB, Analisa, Bahan, Alat, Upah. Semua mengikuti versi RAB
yang dipilih. Detail analisa mengikuti lembar AHSP: tenaga/bahan/peralatan,
koefisien, harga dan jumlah, subtotal A/B/C, biaya langsung D, overhead &
profit E sesuai sumber, harga D+E serta pembulatan sumber. TKDN ditunda.

### UI konsisten dan penelusuran nilai (D-061)

Semua halaman memakai hirarki judul, formulir, tabel, loading/error dan navigasi
yang konsisten serta nyaman di mobile. Nilai domain RAB/AHSP/harga
dapat dibuka untuk melihat asalnya: rumus, operand, baris rinci, analisa,
harga dasar atau dokumen asli. Nilai input manual dan override dijelaskan
sebagai input/keputusan, bukan diberi sumber Excel buatan. Nilai tidak
mengubah histori atau dihitung ulang untuk mengganti snapshot approved.

### Satu tingkat tab pada Lihat RAB (D-062)

Halaman satu versi RAB dan semua rincian paketnya hanya menampilkan tab
Rekap RAB / Analisa / Bahan / Alat / Upah. Tab detail proyek tidak diulang;
tautan kembali ke proyek dan daftar versi tersedia di atas tab paket.

### Batas penelusuran nilai (D-064)

Klik asal nilai hanya untuk angka RAB dan pendukung perhitungannya: analisa,
harga bahan/upah/alat, perbandingan dan review impor RAB. Identitas proyek,
kontrak, SPMK, kalender serta pratinjau jadwal memakai teks biasa tanpa
garis bawah atau dialog asal nilai. Navigasi dan aksi form tetap tersedia.
