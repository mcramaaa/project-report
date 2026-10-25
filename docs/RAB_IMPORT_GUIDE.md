# Panduan Tetap Impor RAB dan Analisa

**Koreksi kebutuhan 2026-10-26 (D-056):** daftar analisa dan harga harus
mandiri per versi RAB, bukan gabungan proyek. Penggabungan disiplin hanya
di dalam RAB yang sama. Kandidat dari RAB lain disalin ke paket tujuan
setelah review, bukan ditautkan sebagai master bersama. Dokumen dan runtime
versi 1 di bawah merekam implementasi sebelumnya; sebelum alur baru diklaim
selesai, terbitkan versi panduan/prompt berikutnya dan sinkronkan schema,
validator, test, serta catatan versi run. Jangan menerapkan perubahan scope
secara diam-diam pada extraction run lama.

Versi panduan: 1. Acuan: PRD §11/§29 dan D-045–D-053. Ini spesifikasi
untuk implementasi, prompt AI, validator, dan review. Runtime: instruksi
`rab-import-guide@1` di `apps/api/src/imports/guide/` (prompt + schema zod),
tercatat pada setiap run impor; perubahan panduan wajib menaikkan versinya dan
test sinkronisasi memeriksa nomor versi dokumen ini. Rumus analisa D-051,
harga referensi D-050, status D-048.

## Hasil di Sistem

- Satu RAB per proyek dan versi baseline; Kontrak, MC0, Addendum tetap terpisah.
- Satu daftar analisa gabungan proyek, walau sumber memisahkan Struktur,
  Arsitektur, MEP di file/sheet berbeda atau mencampurnya dengan RAB.
- Harga upah/bahan/alat × koefisien → harga satuan analisa → dikalikan volume
  pekerjaan → nilai item → rekap dan bobot. Semua kalkulasi kritis decimal-safe.
- Hanya analisa dan komponen/harga yang dipakai item RAB menjadi data domain.
  File asli tetap disimpan lengkap; data histori tidak dihapus.

## Nama Rekap dan Bukti Formula

Nama item RAB mengikuti uraian pekerjaan pada rekap sumber yang dipilih dan
dikonfirmasi reviewer. Nama analisa asli tetap disimpan pada analisa, tidak
diganti. Nama berbeda tidak menggugurkan relasi yang dibuktikan formula.

Contoh ilustrasi, bukan pemetaan posisi sel untuk semua workbook:

```text
Rekap!B12 : "Pek. Pasangan Dinding Bata"
Rekap!F12 : ='Analisa Arsitektur'!H87
Analisa Arsitektur!H87 : harga analisa "1 m2 Pasangan Bata Merah"

Item RAB : "Pek. Pasangan Dinding Bata"
Analisa  : "1 m2 Pasangan Bata Merah"
Bukti    : formula Rekap!F12 → Analisa Arsitektur!H87
```

Telusuri rantai referensi melalui sheet perantara seperti REKAP ANALISA
hingga analisa rinci. Backend menyediakan formula asli, cached value, locator,
dan named range yang tersedia. Referensi yang dapat dibuktikan menjadi acuan
pemetaan; kemiripan nama/kode hanya membantu usulan kandidat.

Pastikan target adalah harga analisa yang benar, satuannya sesuai, dan berasal
dari proyek/versi yang dimaksud. Referensi subtotal ke beberapa pekerjaan
bukan bukti bahwa kelompok itu memakai satu analisa. Rumus yang menggabungkan
beberapa analisa tidak boleh dipaksa menjadi satu kandidat.

Formula hilang, referensi eksternal tanpa file sumber, rumus dinamis yang belum
didukung, atau kandidat ambigu masuk review manusia. Jangan mengarang target
atau mengganti bukti formula dengan tebakan nama.

Simpan bukti: identitas/hash dokumen, sheet/sel/baris, formula dan rantai
referensi, nama rekap, nama analisa asli, hasil validasi, serta koreksi dan
keputusan reviewer. Ini requirement provenance; DTO/schema final dirancang
sebelum coding pipeline.

## Urutan Impor

1. Simpan file asli; inventarisasi file/sheet/blok data dan versi tujuan.
2. Identifikasi pekerjaan rekap/RAB. Bedakan ITEM dari kelompok, subtotal,
   total, dan referensi; jangan menghitung rekap dan rincian dua kali.
3. Ambil nama dari rekap; telusuri formula harga/jumlah ke analisa rinci.
4. Dari analisa terpakai, ambil komponen, koefisien, dan harga yang diperlukan.
   Beberapa item boleh menggunakan satu analisa; jangan menduplikasi komponen.
5. Konsolidasikan satu daftar analisa. Kode sama belum tentu identitas sama;
   konflik ditampilkan untuk review, bukan auto-merge.
6. Hitung dan rekonsiliasi harga analisa, nilai item, kelompok, dan rekap
   memakai Decimal. RAB mengikuti D-043; rumus AHSP, pajak, overhead/profit,
   dan rounding mengikuti keputusan OD-011/OD-012, tanpa asumsi tarif.
7. Tampilkan sumber, formula, kedua nama, kandidat relasi, selisih angka,
   dan referensi tidak diimpor pada structured draft.
8. Schema validation → business validation → human review → approval domain
   → data resmi dan audit. Approval multi-step harus konsisten/transaksional.

Volume 0 bukan otomatis tidak terpakai; mulai dari item yang masuk versi RAB.
Koefisien 0 dalam analisa terpilih tidak otomatis dibuang. Impor baru tidak
menimpa RAB approved, analisa yang dirujuk histori, atau snapshot final.

## Penggunaan oleh AI Aplikasi

- Pipeline M5/M7 wajib memasukkan aturan panduan ke instruksi impor tetap
  dan structured schema. Jangan mengandalkan riwayat chat pengguna.
- Kirim sumber yang relevan: item rekap dan namanya, formula/rantai referensi,
  kandidat analisa, serta komponen/harga. Minta pemetaan disertai bukti.
- Validator backend memeriksa bukti terhadap sumber dan menghitung angka;
  AI tidak langsung menulis data resmi.
- Versi instruksi/panduan perlu tercatat bersama extraction run agar perubahan
  model/prompt dapat ditelusuri; bentuk penyimpanan diputuskan dalam schema/API.
- Perubahan panduan disinkronkan dengan prompt, validator, dan test regresi.
  File Markdown saja tidak otomatis terbaca model yang dipanggil via 9router.

## Kasus Regresi Minimum

- Nama rekap berbeda dengan analisa, formula benar: relasi ditemukan, nama
  item mengikuti rekap dan nama analisa asli tetap ada.
- Formula berantai; file/sheet terpisah atau gabungan; sumber eksternal hilang.
- Kode sama tetapi analisa berbeda; satu analisa digunakan beberapa item.
- Formula ambigu/hilang: review, tanpa pemetaan otomatis berdasarkan tebakan.
- Subtotal/total tidak menjadi ITEM; hanya referensi terpakai diimpor.
- Kalkulasi direkonsiliasi dengan sumber; RAB approved dan histori tidak berubah.

Checklist di ACCEPTANCE_TESTS §K; keputusan terbuka tetap di DECISIONS.
Workbook nyata disimpan di storage dan tidak dimasukkan ke Git.
