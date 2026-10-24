# AI Extraction Design

## 1. Tujuan

Membantu admin mengubah RAB/AHSP dari Excel atau PDF menjadi data standar aplikasi tanpa mengetik ulang ratusan baris.

AI bukan sumber kebenaran.

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
- row/column coordinates
- formatting hints secukupnya
- candidate table regions

Hasil dibuat menjadi normalized representation.

AI kemudian bertugas memetakan representation ke schema domain.

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
