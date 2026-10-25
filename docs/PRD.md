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

Izin dibagi dua lapis (D-026, detail di `docs/PERMISSIONS.md`):

- **System admin** (`users.is_system_admin`): administrasi global — pengelolaan user, pembuatan proyek, pengelolaan anggota/role proyek. Tidak otomatis boleh membaca/mengubah data proyek.
- **Role proyek** (`project_users.role`): akses per proyek. Satu user dapat memiliki role berbeda di proyek berbeda. Role bukan level berurutan.

Role proyek:

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
- pengelolaan Addendum
- preview/presentasi

### ADMIN (role proyek)
- upload dokumen
- review hasil ekstraksi AI

Membuat proyek, pengelolaan user, dan konfigurasi sistem adalah wewenang system admin.

### Akun User

- tidak ada pendaftaran publik; akun dibuat system admin dengan password awal
- user dinonaktifkan, tidak dihapus permanen
- system admin aktif terakhir tidak boleh dinonaktifkan atau dicabut haknya
- nonaktivasi dan perubahan password mencabut semua session user tersebut
- perubahan izin berlaku pada request berikutnya
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

## 4. Baseline dan Versi RAB

Satu proyek memiliki versi RAB:

1. CONTRACT
2. MC0
3. ADDENDUM 1
4. ADDENDUM 2
5. dst

Setiap versi disimpan terpisah dan tidak saling overwrite.

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

## 7. Tanggal Efektif Addendum

Setiap Addendum menyimpan:

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

AHSP dapat digunakan kembali dan dapat memiliki versi bila diperlukan.

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

Periode terakhir dapat kurang dari 28 hari.

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
- aksi user, system admin, membership, password, dan session (daftar di `docs/PERMISSIONS.md` §4)

Audit global (misalnya pengelolaan user) tidak memiliki project. Password, hash, token, dan secret tidak pernah dicatat.

## 28. Dokumen dan File

Simpan file asli:

- Kontrak
- RAB Kontrak
- MC0
- Addendum
- AHSP
- Schedule
- template
- dokumen lain

Database menyimpan metadata dan path/hash.

File tidak disimpan sebagai blob besar di database.

## 29. AI Extraction

Admin upload Excel/PDF.

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
