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

- id
- project_id
- document_type
- document_number
- document_date
- original_filename
- stored_filename
- file_path
- mime_type
- file_size
- sha256
- uploaded_by
- uploaded_at
- status

Document types:
- CONTRACT
- SPMK
- RAB_CONTRACT
- MC0
- ADDENDUM
- AHSP
- SCHEDULE
- TEMPLATE
- OTHER

## 3. AI Extraction

### ai_extractions

- id
- project_document_id
- extraction_type
- attempt_number
- provider
- model
- started_at
- finished_at
- raw_response
- structured_result
- status
- error_message
- created_by
- created_at

Status:
- PENDING
- PROCESSING
- NEEDS_REVIEW
- FAILED
- APPROVED
- REJECTED

### ai_extraction_rows

- id
- extraction_id
- source_sheet
- source_row
- source_locator
- sort_order
- row_type
- code
- description
- volume
- unit
- analysis_no
- unit_price
- tax_percent
- unit_price_with_tax
- subtotal
- weight
- confidence
- validation_status
- review_status
- review_note

### ai_extraction_reviews

- id
- extraction_id
- reviewed_by
- reviewed_at
- decision
- notes

## 4. RAB Versioning

### rab_versions

Milestone 4 (D-040). Kolom yang belum dibuat: `document_id` (M5), `effective_date` (M6).

- id
- project_id → projects (RESTRICT)
- version_type — CONTRACT | MC0 | ADDENDUM
- revision_number — 0 untuk CONTRACT/MC0; 1, 2, … untuk ADDENDUM
- document_number nullable
- document_date nullable
- previous_version_id nullable → rab_versions (versi approved yang disalin)
- status — DRAFT | APPROVED | DISCARDED
- total_before_tax, total_tax, total_value DECIMAL(20,2) nullable — snapshot saat approve; draft dihitung saat dibaca
- created_by → users
- approved_by, approved_at nullable
- discarded_by, discarded_at, discard_reason nullable
- created_at
- updated_at

Index: `project_id, status`. Urutan versi dan "satu DRAFT per proyek" ditegakkan service dengan lock baris proyek.

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
- volume DECIMAL(18,4) nullable — hanya ITEM
- unit nullable
- analysis_code nullable — teks no analisa sampai AHSP (M7)
- unit_price DECIMAL(20,2) nullable
- tax_percent DECIMAL(5,2) nullable
- unit_price_with_tax, subtotal DECIMAL(20,2), weight DECIMAL(12,6) nullable — snapshot saat approve (D-042)
- previous_version_item_id nullable → rab_version_items (baris asal salinan)
- created_at
- updated_at

Unique: `rab_version_id + work_item_id`.

Tidak disimpan karena dihitung: `change_type` (dari `work_item_id` antarversi), `is_progress_trackable` (= ITEM), baris SUBTOTAL/TOTAL. Baris draft boleh dihapus; versi APPROVED/DISCARDED tidak diubah.

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

## 5. AHSP

### ahsp_analyses

- id
- analysis_number
- description
- unit

### ahsp_analysis_versions

- id
- ahsp_analysis_id
- source_document_id
- version_label
- effective_date
- status
- created_at

### ahsp_components

- id
- analysis_version_id
- component_type
- description
- unit
- coefficient
- reference_price

component_type:
- MATERIAL
- LABOR
- EQUIPMENT

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

- volume: DECIMAL(18,4)
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
