# Database Design

Dokumen ini adalah ERD konseptual. Implementasi detail dituangkan ke Prisma schema.

## 1. Core Tables

Dibuat di Milestone 1 (D-028); tabel role ditambahkan oleh migration `dynamic_roles` (D-035). Semua `id` adalah UUID v7 `CHAR(36)` (D-027). Timestamp `DATETIME(3)` UTC. Foreign key memakai `ON DELETE RESTRICT`; data inti tidak di-hard-delete.

### users

- id
- name
- email — dinormalisasi trim + huruf kecil; unique
- password_hash — scrypt (D-030), tidak pernah dikirim ke client
- is_active — default true; nonaktivasi menggantikan delete
- is_system_admin — default false; super admin (D-035)
- created_at
- updated_at

Index: `is_system_admin, is_active` (pemeriksaan system admin aktif terakhir).

### auth_sessions

- id
- user_id → users
- token_hash — SHA-256 token session, unique; token mentah tidak disimpan
- created_at
- expires_at
- revoked_at nullable
- ip_address nullable
- user_agent nullable

Index: `user_id`.

Session valid bila `revoked_at IS NULL`, `expires_at > now`, dan user aktif.

### projects

Kolom identitas mengikuti PRD §3 (data minimum, wajib diisi):

- id
- code — unique
- activity_name
- sub_activity_name
- project_name
- location
- fiscal_year
- contractor_name
- consultant_name
- contract_number
- contract_date
- spmk_number
- spmk_date
- contract_value DECIMAL(20,2) nullable — wajib lewat API; null hanya untuk proyek sebelum M3 (D-039)
- start_date
- duration_days — 1–3650 (validasi API)
- status — ACTIVE | CLOSED (D-036)
- created_at
- updated_at

Tanggal selesai rencana tidak disimpan; dihitung `start_date + duration_days − 1` (D-036).

### roles

- id
- code — unique, huruf besar
- name
- description nullable
- scope — GLOBAL | PROJECT
- is_system — role bawaan FILLER/REVIEWER/MANAGER/ADMIN; kode, scope, status terkunci
- is_active — role nonaktif tidak memberi permission
- created_at
- updated_at

Role tidak di-hard-delete.

### role_permissions

- role_id → roles
- permission_code — kode dari katalog `packages/shared` (`PERMISSIONS`), harus sesuai scope role
- created_at

Primary key: `role_id + permission_code`.

### user_global_roles

Penugasan role administrasi (scope GLOBAL) tanpa proyek.

- id
- user_id → users
- role_id → roles
- created_by nullable → users
- created_at
- updated_at
- revoked_at nullable
- revoked_by nullable → users

Unique: `user_id + role_id` (memberi ulang mengaktifkan baris yang sama).

### project_users

- id
- project_id → projects
- user_id → users
- role_id → roles (scope PROJECT)
- created_by nullable → users
- created_at
- updated_at
- revoked_at nullable — membership dicabut (soft revoke, D-029)
- revoked_by nullable → users

Unique:
- project_id + user_id

Index: `user_id`, `role_id`.

Membership aktif = `revoked_at IS NULL`.

### audit_logs

Lihat §11.

## 2. Documents

### project_documents

File asli disimpan di `storage/projects/<project_id>/documents/<stored_filename>` (nama acak), bukan blob database.

- id
- project_id → projects (RESTRICT)
- original_filename
- stored_filename — unik, UUID + ekstensi
- mime_type
- file_size
- sha256
- uploaded_by → users
- uploaded_at

Index: `project_id`, `sha256`. Dokumen tidak dihapus.

## 3. RAB Import (D-048, D-052)

### rab_imports

Satu run impor paket ke satu versi RAB tujuan.

- id
- project_id → projects
- target_version_type — CONTRACT | MC (D-069)
- target_revision_number — nomor MC yang diimpor (0 untuk CONTRACT), ditetapkan saat run dibuat
- status — UPLOADED | PROCESSING | NEEDS_REVIEW | APPROVED | REJECTED | FAILED
- attempt_number, previous_import_id nullable → rab_imports (retry)
- guide_version — mis. `rab-import-guide@1`
- parser_version
- draft JSON nullable — structured draft tervalidasi schema (baris RAB, analisa terpakai, harga, bukti formula, issues, kandidat)
- error_message nullable
- deleted_at nullable — soft delete run belum digunakan (D-066); histori tetap tersimpan
- created_by, created_at, updated_at, processed_at
- approved_by, approved_at, rejected_by, rejected_at, reject_reason nullable
- rab_version_id nullable → rab_versions (hasil), price_list_id nullable → price_lists (hasil)

### rab_import_documents

- import_id → rab_imports, document_id → project_documents (PK keduanya)

### rab_import_decisions

Keputusan reviewer, append-only (keputusan terakhir per `row_key` + `kind` berlaku).

- id
- import_id → rab_imports
- row_key — kunci baris draft
- kind — ANALYSIS_LINK | PRICE_CHOICE | DIRECT_PRICE | WORK_ITEM_MATCH
- value JSON — mis. `{ analysisKey }`, `{ source: 'ANALYSIS' | 'SOURCE_OVERRIDE' }`, `{ workItemId | null }`
- reason nullable (wajib untuk override)
- decided_by → users, decided_at

### ai_runs

Setiap panggilan model.

- id
- import_id → rab_imports
- purpose
- instruction_version
- model — model aktual yang menjawab/gagal
- attempt
- status — SUCCEEDED | FAILED
- error nullable
- response JSON nullable (tanpa API key)
- started_at, finished_at

Tabel lama `ai_extractions`/`ai_extraction_rows`/`ai_extraction_reviews` digantikan oleh tabel di atas.

## 4. RAB Versioning

### rab_versions

Milestone 4 (D-040). Kolom yang belum dibuat: `document_id` (M5), `effective_date` (M6).

- id
- project_id → projects (RESTRICT)
- version_type — CONTRACT | MC (D-069)
- revision_number — 0 untuk CONTRACT; nomor MC 0 … 100 untuk MC
- document_number nullable
- document_date nullable
- previous_version_id nullable → rab_versions (versi approved yang disalin)
- status — DRAFT | APPROVED | DISCARDED | REOPENED (D-068: versi approved yang dibuka kembali untuk koreksi)
- total_before_tax, total_tax, total_value DECIMAL(50,18) nullable — snapshot eksak saat approve (D-043); draft/REOPENED dihitung saat dibaca. REAL COST (2 desimal) dan DIBULATKAN dihitung dari total_value
- created_by → users
- approved_by, approved_at nullable — approval terakhir; urutan versi tidak memakai kolom ini
- discarded_by, discarded_at, discard_reason nullable
- created_at
- updated_at

Index: `project_id, status`. Urutan versi (domain Kontrak → MC-0 → MC-1 … MC-100) dan "satu DRAFT/REOPENED per proyek" ditegakkan service dengan lock baris proyek.

### rab_version_snapshots

D-068, append-only (tidak pernah di-update/dihapus oleh aplikasi).

- id
- rab_version_id → rab_versions (RESTRICT); unique `rab_version_id, sequence`
- sequence SMALLINT — 1, 2, … per versi
- approved_by → users nullable, approved_at nullable — approval yang diarsipkan
- total_value DECIMAL(50,18) nullable — untuk daftar
- payload JSON — identitas versi, seluruh baris (hierarki, WI, angka snapshot, provenance, relasi salinan) dan paket (harga dasar, analisa, komponen, provenance); decimal sebagai string
- checksum CHAR(64) — SHA-256 dari JSON kanonis (key terurut), bukan urutan key JSON MySQL
- created_by → users, created_at — siapa/kapan mengarsipkan (approval, atau reopen pertama untuk versi approved lama)

Koreksi (D-068) menambah entri `corrections` (`at`, `by`, `reason`, `kind` MANUAL/RECALCULATED, `changes` before/after) pada `source_locator` baris yang berubah — item RAB, harga dasar, komponen, versi analisa — tanpa menghapus lokasi/bukti Excel asli.

### work_items

Permanent project work identity. Dibuat saat baris ITEM baru ditambahkan; terbawa ke versi berikutnya lewat salinan.

- id
- project_id → projects (RESTRICT)
- internal_code — `WI-0001`, unique per proyek
- canonical_description
- created_at

### rab_version_items

- id
- rab_version_id → rab_versions (RESTRICT)
- work_item_id nullable → work_items (RESTRICT) — hanya ITEM
- parent_item_id nullable → rab_version_items (RESTRICT), versi yang sama
- sort_order — urutan di antara saudara
- row_type — SECTION | SUBSECTION | PARENT_ITEM | ITEM
- display_number nullable
- description
- volume DECIMAL(30,12) nullable — hanya ITEM (D-043)
- unit nullable
- analysis_code nullable — teks no analisa sampai AHSP (M7)
- unit_price DECIMAL(20,2) nullable
- tax_percent DECIMAL(5,2) nullable
- unit_price_with_tax DECIMAL(26,6), subtotal DECIMAL(48,18) nullable — snapshot eksak saat approve (D-043)
- previous_version_item_id nullable → rab_version_items (baris asal salinan)
- analysis_version_id nullable → ahsp_analysis_versions (D-049/D-051)
- price_source — MANUAL | ANALYSIS | SOURCE_OVERRIDE | DIRECT
- source_unit_price, analysis_unit_price DECIMAL(40,12) nullable — harga sumber dan harga analisa saat diputuskan
- price_note nullable — alasan override
- price_decided_by nullable → users, price_decided_at nullable
- source_locator JSON nullable — dokumen/sheet/baris sumber impor
- created_at
- updated_at

Unique: `rab_version_id + work_item_id`.

Tidak disimpan karena dihitung: bobot (dari jumlah snapshot), `change_type` (dari `work_item_id` antarversi), `is_progress_trackable` (= ITEM), baris SUBTOTAL/TOTAL. Baris draft boleh dihapus; versi APPROVED/DISCARDED tidak diubah.

### baseline_assignments

- id
- project_id
- rab_version_id
- effective_from
- effective_to
- activation_mode
- reason
- created_by
- created_at

activation_mode:
- NEXT_WEEK
- EXACT_DATE

## 5. AHSP (D-050, D-051)

Paket analisa dan harga dimiliki **versi RAB** (D-056, D-057; migration
`20261026090000_rab_version_packages`). Relasi item RAB, analisa, subanalisa,
dan harga berada dalam paket yang sama; backend menolak relasi lintas paket.
Salinan dari paket lain menyimpan `copied_from_id`. Paket lama di-backfill
dari impor asalnya; relasi lintas paket yang sudah approved tidak diubah.

### price_lists

Daftar harga paket satu versi RAB; dibuat saat approve impor atau saat
paket disalin, tidak diubah setelah RAB approved.

- id
- project_id → projects
- rab_version_id → rab_versions — unique (satu paket per versi RAB)
- version_number — unique per proyek (urutan pembuatan)
- source_import_id → rab_imports
- location, period nullable — metadata dari sumber
- created_by, created_at

### price_items

Hanya harga yang dipakai komponen analisa terpakai (D-046).

- id
- price_list_id → price_lists
- name
- unit nullable
- price DECIMAL(40,12)
- source_locator JSON — dokumen, sheet, sel
- copied_from_id nullable → price_items (provenance salinan)

### ahsp_analyses

Identitas analisa dalam **satu daftar gabungan per versi RAB** (D-056). Kode tidak unik dan bukan identitas.

- id
- project_id → projects
- rab_version_id → rab_versions — pemilik paket
- code, name, unit — dari sumber saat pertama dibuat
- created_at

### ahsp_analysis_versions

Tidak diubah setelah dibuat; item RAB menunjuk versi.

- id
- analysis_id → ahsp_analyses
- version_number — unique per analisa
- price_list_id → price_lists — daftar harga paket yang sama
- source_import_id nullable → rab_imports — kosong untuk salinan "Buat versi"
- copied_from_id nullable → ahsp_analysis_versions (provenance salinan)
- code, name, unit — snapshot sumber (nama analisa asli, tidak ditimpa nama rekap)
- discipline nullable — metadata/filter (Struktur/Arsitektur/MEP bila diketahui)
- overhead_percent DECIMAL(9,4) nullable
- rounding_scale nullable — pembulatan harga sesuai sumber (D-051)
- direct_cost, overhead_amount, price_exact DECIMAL(50,24)
- price DECIMAL(40,12) — harga satuan analisa (setelah pembulatan sumber)
- source_locator JSON
- created_at

### ahsp_components

- id
- analysis_version_id → ahsp_analysis_versions
- sort_order
- category — LABOR | MATERIAL | EQUIPMENT
- description, unit
- coefficient DECIMAL(30,12)
- price_item_id nullable → price_items
- sub_analysis_version_id nullable → ahsp_analysis_versions (analisa bertingkat)
- sub_price_basis nullable — EXACT | ROUNDED
- unit_price DECIMAL(40,12) — snapshot harga komponen
- amount DECIMAL(65,24) — koefisien × harga, eksak
- source_locator JSON

Tepat satu dari `price_item_id`/`sub_analysis_version_id`, atau keduanya null untuk harga literal di analisa (locator menunjuk selnya).

## 6. Schedule

### schedule_versions

- id
- project_id
- rab_version_id
- version_number
- document_id
- effective_date
- status
- created_at

### schedule_items

- id
- schedule_version_id
- week_id
- work_item_id
- planned_volume
- planned_weight
- planned_cumulative_weight

## 7. Weeks & Progress

### weeks

Blok 7 hari sejak `projects.start_date`; minggu terakhir dipotong pada tanggal selesai rencana (D-037).

- id
- project_id → projects (RESTRICT)
- report_period_id → report_periods (RESTRICT) — periode tempat minggu ini berada
- week_number
- start_date
- end_date
- created_at
- updated_at

Unique:
- project_id + week_number

Jumlah hari dihitung dari tanggal. `status` ditunda sampai OD-005. Foreign key dari tabel lain ke `weeks` wajib RESTRICT.

### week_baseline_segments

Untuk dukungan exact-date di tengah minggu.

- id
- week_id
- rab_version_id
- start_date
- end_date

### weekly_progress

- id
- week_id
- work_item_id
- input_mode
- input_percentage
- actual_volume
- note
- entered_by
- entered_at
- updated_at

Unique:
- week_id + work_item_id

input_mode:
- PERCENT_CUMULATIVE
- VOLUME_WEEK

## 8. Daily

### daily_allocations

- id
- weekly_progress_id
- work_item_id
- work_date
- volume
- allocation_method
- factor
- is_manual_override
- baseline_version_id
- created_at
- updated_at

allocation_method:
- DAILY_FACTOR
- SCHEDULE
- MANUAL

### daily_reports

- id
- project_id
- week_id
- report_date
- day_sequence
- status
- general_note
- created_by
- checked_by
- finalized_by
- finalized_at

### daily_weather

- id
- daily_report_id
- weather_type
- start_time
- end_time
- note

### daily_labor

- id
- daily_report_id
- labor_type
- quantity
- note
- source

### daily_materials

- id
- daily_report_id
- material_key
- calculated_quantity
- actual_quantity
- unit
- source
- is_manual_override
- note

### daily_equipment

- id
- daily_report_id
- equipment_key
- calculated_quantity
- actual_quantity
- unit
- is_manual_override
- note

## 9. Periodic Reports

### report_periods

Periode 4 minggu/28 hari (B.n), minggu `4n−3` s.d. `4n`; periode terakhir dipotong pada tanggal selesai rencana (D-037).

- id
- project_id → projects (RESTRICT)
- period_number
- start_date
- end_date
- created_at
- updated_at

Unique:
- project_id + period_number

Tidak disimpan karena dapat dihitung: `number_of_days`, `first_week_number`, `last_week_number`. Keanggotaan minggu disimpan di `weeks.report_period_id` (menggantikan `report_period_weeks`). `status` ditunda sampai OD-005.

## 10. Finalization

### report_snapshots

- id
- project_id
- report_type
- daily_report_id nullable
- week_id nullable
- report_period_id nullable
- baseline_version_id
- schedule_version_id
- snapshot_data
- checksum
- finalized_by
- finalized_at
- version_number

report_type:
- DAILY
- WEEKLY
- PERIOD_28D

### report_exports

- id
- report_snapshot_id
- format
- file_path
- generated_by
- generated_at

format:
- XLSX
- PDF
- PPTX

## 11. Audit

### audit_logs

Dibuat di Milestone 1.

- id
- project_id nullable → projects (audit global tanpa proyek)
- user_id nullable → users (actor; null untuk seed/sistem)
- action — string, daftar di `docs/PERMISSIONS.md` §4
- entity_type
- entity_id nullable
- old_value JSON nullable — hanya field aman
- new_value JSON nullable — hanya field aman
- reason nullable
- created_at

Index: `project_id + created_at`, `entity_type + entity_id`, `user_id`, `created_at`.

Append-only: aplikasi tidak pernah update/delete baris audit.

## 12. Decimal Recommendations

- volume: DECIMAL(18,4); volume RAB DECIMAL(30,12) mengikuti workbook (D-043)
- coefficient: DECIMAL(18,6)
- unit_price: DECIMAL(20,2)
- subtotal: DECIMAL(20,2)
- weight: DECIMAL(12,6)
- percentage: DECIMAL(12,6)

## 13. Important Constraints

- progress tidak boleh hard-linked hanya ke satu baseline version
- approved baseline tidak di-hard-delete
- final snapshot immutable
- audit log append-oriented
- AI draft terpisah dari official RAB
