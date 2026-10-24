# UI / UX Flow

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

### Step 1 Identitas
- kegiatan
- sub kegiatan
- pekerjaan
- lokasi
- tahun

### Step 2 Kontrak
- nomor
- tanggal
- nilai

### Step 3 SPMK
- nomor
- tanggal
- tanggal mulai
- masa pelaksanaan

Sistem generate minggu dan periode 4 minggu.

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
