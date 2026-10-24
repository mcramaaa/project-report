# Mapping Workbook Kantor -> Aplikasi

Dokumen ini merekam interpretasi struktur workbook contoh yang dipakai dalam diskusi.

## 1. RAB + PPN

Fungsi:
- baseline RAB
- perbandingan Kontrak dan MC0 pada workbook sumber

Aplikasi:
- `rab_versions`
- `work_items`
- `rab_version_items`

Jangan menyimpan Kontrak/MC0 sebagai dua kolom permanen pada satu record item. Gunakan versioning.

## 2. REKAP RAB

Fungsi:
- rekap nilai/bobot

Aplikasi:
- dihitung/ditampilkan dari RAB version
- dapat menjadi export view

## 3. REKAP ANALISA

Fungsi:
- referensi no analisa / uraian / harga

Aplikasi:
- `ahsp_analyses`
- `ahsp_analysis_versions`

## 4. Master Material

Fungsi:
- mapping pekerjaan/analisa ke material
- koefisien
- satuan

Aplikasi:
- `ahsp_components`

Material harian dihitung dari:
- daily work volume * coefficient

## 5. M.n pada Mingguan

Fungsi:
- progress item per minggu

Temuan desain:
- minggu awal dapat mengambil baseline Kontrak
- minggu berikutnya dapat beralih ke MC0

Aplikasi:
- `weeks`
- `week_baseline_segments`
- `weekly_progress`

## 6. RM.n

Fungsi:
- rekap mingguan

Aplikasi:
- generated weekly report
- tidak perlu tabel data duplikat

## 7. Curva S M.n

Fungsi:
- rencana vs aktual mingguan

Aplikasi:
- schedule version + weekly progress
- generated chart/report

## 8. Daily Workbook

Sheet `M.n` dapat mewakili 7 hari dalam satu minggu.

Aplikasi tidak membuat satu tabel per sheet.

Gunakan:
- `daily_reports`
- `daily_allocations`
- `daily_labor`
- `daily_materials`
- `daily_equipment`
- `daily_weather`

## 9. Faktor Harian

Workbook contoh memperlihatkan 7 faktor yang totalnya 7.

Interpretasi aplikasi:
- faktor melekat pada Hari ke-1 s.d. Hari ke-7 dalam minggu proyek
- bukan selalu Senin-Minggu kalender

## 10. B.n pada Bulanan

Temuan desain:
- B1 = M4
- B2 = M8
- dst sebagai posisi kumulatif akhir blok 4 minggu
- periode bulanan kantor adalah 28 hari / 4 minggu

Aplikasi:
- `report_periods`
- `report_period_weeks`

Tidak ada progress input baru.

## 11. RB.n

Fungsi:
- rekap periode 4 minggu

Aplikasi:
- generated report

## 12. CS B.n

Fungsi:
- Kurva S periode

Aplikasi:
- generated view dari schedule + actual

## 13. External Workbook Links

Workbook lama dapat memiliki link antar-file.

Aplikasi tidak boleh bergantung pada link seperti itu.

Semua relasi internal harus melalui database.

Excel export dibuat standalone sebisa mungkin.
