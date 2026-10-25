# AI Extraction Design

Scope target terbaru: D-056. Paket analisa/harga dimiliki masing-masing
versi RAB (Penawaran/Kontrak, MC0, Addendum), bukan master bersama proyek.
Normalisasi disiplin menjadi satu daftar hanya dalam paket RAB tujuan.
Kandidat dari paket lain perlu dikonfirmasi dan disalin beserta dependency
terpakainya; backend menolak relasi analisa/harga lintas paket. Pipeline dan
prompt versi 1 yang telah dibuat perlu dimigrasikan sebelum memenuhi scope ini.

## 1. Tujuan

Membantu admin mengubah RAB/AHSP dari Excel atau PDF menjadi data standar aplikasi tanpa mengetik ulang ratusan baris.

AI bukan sumber kebenaran.

Panduan impor tetap: `docs/RAB_IMPORT_GUIDE.md` (D-045–D-047). Implementasi
pipeline harus memasukkan aturan ini ke instruksi AI dan validasi backend;
menyimpan Markdown saja belum mengintegrasikannya ke model aplikasi.

Implementasi v1 (D-048–D-053): penelusuran formula deterministik di backend;
model 9router hanya membantu kandidat untuk baris yang rantainya putus/ambigu.
Model utama `AI_MODEL`, cadangan `AI_FALLBACK_MODEL`; setiap panggilan
tercatat di `ai_runs`. Status run: UPLOADED → PROCESSING → NEEDS_REVIEW →
APPROVED/REJECTED, atau FAILED (teknis). Format v1 `.xlsx`; PDF menyusul.

## 2. Flow

```text
Upload
-> save original
-> preprocess
-> call AI
-> structured JSON
-> schema validation
-> business validation
-> review
-> approval
-> official data
```

## 3. Excel Strategy

Jangan langsung mengandalkan AI membaca workbook mentah.

Backend lebih dulu mengumpulkan:

- sheet names
- dimensions
- merged ranges
- visible cell values
- formulas + cached values bila relevan
- referensi formula dan rantainya dari item rekap ke analisa/komponen, termasuk sheet perantara dan named range yang tersedia
- row/column coordinates
- formatting hints secukupnya
- candidate table regions

Hasil dibuat menjadi normalized representation.

AI kemudian bertugas memetakan representation ke schema domain.

Jika uraian rekap berbeda dengan analisa, formula yang dapat dibuktikan
menjadi acuan pemetaan. Nama item mengikuti rekap; nama analisa asli tetap
tersimpan. Sertakan locator, formula, rantai referensi, dan keputusan review.
Referensi tidak tersedia/ambigu tidak boleh diganti tebakan nama.

## 4. PDF Strategy

Untuk PDF:
- ekstrak text/layout bila tersedia
- gunakan vision/model capability bila layout kompleks
- selalu simpan page/source locator
- bila hasil tidak cukup dipercaya, tandai manual review

## 5. Structured Output

Minimal:

```json
{
  "documentType": "MC0",
  "sourceSheet": "RAB + PPN",
  "items": [
    {
      "sourceRow": 42,
      "rowType": "ITEM",
      "number": "1",
      "description": "Pek. Galian Pondasi",
      "volume": "46.0000",
      "unit": "m3",
      "analysisNumber": "II.1",
      "unitPrice": "125000.00",
      "taxPercent": "11.00"
    }
  ]
}
```

## 6. Row Types

- SECTION
- SUBSECTION
- PARENT_ITEM
- ITEM
- SUBTOTAL
- TOTAL
- UNKNOWN

UNKNOWN wajib review.

## 7. Validation

### Schema validation
- required field shape
- enum
- decimal string
- source locator

### Business validation
- volume non-negative
- price non-negative
- coefficient non-negative
- subtotal consistency
- weight consistency
- analysis reference
- hierarchy sanity

## 8. Retry

Attempt 1:
- AI returns structured JSON

Jika schema invalid:
- kirim schema errors untuk satu retry

Jika masih invalid:
- NEEDS_MANUAL_REVIEW

Tidak retry tanpa batas.

## 9. MC0/Addendum Comparison

Setelah ekstraksi, bandingkan dengan baseline sebelumnya.

Matching signals:
- code/number
- parent path
- normalized description
- analysis number
- unit
- location/order
- AI suggestion

Status:
- MATCHED
- NEW
- UNCERTAIN
- REMOVED

UNCERTAIN tidak boleh auto-approve.

## 10. Approval

Approval harus membuat official records dalam satu transaction:

- rab_version
- work_items baru bila approved
- rab_version_items
- baseline assignment bila activation dipilih
- audit log

Jika gagal:
- rollback semua

## 11. Traceability

Harus bisa menelusuri angka official ke:

```text
official RAB item
-> extraction row
-> source sheet/row/page
-> extraction run
-> model
-> original file
```

## 12. 9router

Backend only:

```text
NINEROUTER_BASE_URL=http://localhost:20128/v1
```

API key tidak masuk browser.

## 13. Storage yang Disimpan

- original file
- hash
- upload user/time
- model/provider
- raw response
- structured result
- validation issues
- admin corrections
- reviewer
- approval timestamp
- resulting RAB version

## 14. Paket Multi-Dokumen dan Multi-Disiplin (D-045)

Satu paket dapat berisi RAB Struktur, Arsitektur, MEP, rekap, analisa/AHSP,
dan daftar harga upah/bahan/alat dalam file atau sheet terpisah. Paket diarahkan
ke satu proyek dan satu versi RAB; pemilihan serta pemetaan sumber dikonfirmasi
pada review, bukan disimpulkan hanya dari nama file.

Alur:

```text
upload semua file -> simpan asli -> inventaris file/sheet dan jenis data
-> parsing/ekstraksi -> draft RAB + draft analisa + draft harga sumber
-> pemetaan disiplin dan referensi -> validasi dan rekonsiliasi
-> review manusia -> approval domain -> data resmi
```

- RAB terintegrasi tetap mempertahankan kelompok Struktur/Arsitektur/MEP dan
  hierarki subpekerjaannya. File referensi bukan pekerjaan tambahan.
- Analisa/AHSP dapat berupa satu daftar gabungan lintas disiplin, daftar
  terpisah, atau blok analisa bercampur dengan RAB dalam file/sheet yang sama.
  Inventarisasi dan parsing harus mengenali blok data, bukan menganggap satu
  file/sheet hanya memiliki satu jenis data atau satu disiplin.
- Seluruh bentuk sumber tersebut dinormalisasi ke **satu daftar analisa
  gabungan di sistem** untuk versi RAB tujuan. Jangan membuat daftar analisa terpisah
  berdasarkan file/sheet atau Struktur/Arsitektur/MEP; asalnya tetap tersedia
  sebagai metadata/filter. Konsolidasi daftar tidak berarti menyatukan paksa
  analisa yang berbeda isi atau menghilangkan versi analisa.
- Referensi item ke analisa tidak harus satu-banding-satu. Beberapa item
  dapat merujuk analisa tervalidasi yang sama; reviewer memastikan identitas,
  versi, satuan, dan kecocokannya. Nomor yang sama saja tidak cukup untuk
  menyimpulkan bahwa dua analisa adalah satu identitas.
- Simpan locator per baris, termasuk identitas dokumen. Satu versi dapat
  ditelusuri ke beberapa dokumen; jangan hanya mengandalkan satu document_id.
- Bandingkan subtotal/rekap sumber dengan hasil rincian menggunakan decimal.
  Rekap, subtotal, dan total tidak dihitung ulang sebagai ITEM.
- Nomor analisa/item yang sama lintas disiplin dapat bertabrakan; tampilkan
  sumber dan kandidat relasi untuk diputuskan reviewer, tanpa auto-merge.
- Sumber yang hanya berisi RAB tetap dapat direview sebagai RAB; jangan
  mengarang komponen AHSP atau koefisien yang tidak ada dalam sumber.
- Pada M5, rincian analisa/harga dapat tersimpan sebagai draft yang belum
  resmi. M7 menyelesaikan pengelolaan serta relasi AHSP resmi. UI menunjukkan
  status tiap jenis data secara jelas.
- Rincian schema, API paket, scope harga, dan approval analisa/harga perlu
  dirancang sebelum coding sesuai OD-011. Alur approval RAB yang sudah ada
  tidak otomatis menjadi kebijakan approval AHSP/harga.

## 15. Impor Hanya Referensi yang Digunakan (D-046)

```text
item RAB versi tujuan
-> analisa yang dirujuk
-> komponen upah/bahan/alat beserta koefisiennya
-> harga komponen yang diperlukan
-> validasi harga analisa dan volume × harga terhadap RAB/rekap sumber
-> review dan approval
```

- Tidak membuat record domain untuk daftar analisa/harga yang tidak dirujuk.
  Parsing/inventaris sumber boleh membaca seluruh workbook untuk menemukan
  referensi dan memastikan kecocokan; file asli tetap lengkap.
- Tampilkan ringkasan jumlah referensi dipakai/tidak diimpor, serta referensi
  hilang atau ambigu. Keputusan penggunaan tidak berdasarkan volume > 0.
- Hindari duplikasi analisa dan harga bersama; jangan menyatukan identitas
  berbeda hanya karena kode/nama sama. Tidak menghapus histori impor lama.
- Hitung komponen memakai decimal dan rumus AHSP yang sudah dikonfirmasi
  (OD-011/OD-012). Perbedaan dengan harga RAB harus terlihat saat review.
- Draft ekstraksi tidak langsung mengganti harga pada RAB approved.
