# Database Design

Dokumen ini adalah ERD konseptual. Implementasi detail dituangkan ke Prisma schema.

## 1. Core Tables

Dibuat di Milestone 1 (D-028). Semua `id` adalah UUID v7 `CHAR(36)` (D-027). Timestamp `DATETIME(3)` UTC. Foreign key memakai `ON DELETE RESTRICT`; data inti tidak di-hard-delete.

### users

- id
- name
- email — dinormalisasi trim + huruf kecil; unique
- password_hash — scrypt (D-030), tidak pernah dikirim ke client
- is_active — default true; nonaktivasi menggantikan delete
- is_system_admin — default false (D-026)
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
- start_date
- duration_days
- created_at
- updated_at

`status` dan `planned_finish_date` belum dibuat (OD-007, Milestone 3).

### project_users

- id
- project_id → projects
- user_id → users
- role — FILLER | REVIEWER | MANAGER | ADMIN
- created_by nullable → users
- created_at
- updated_at
- revoked_at nullable — membership dicabut (soft revoke, D-029)
- revoked_by nullable → users

Unique:
- project_id + user_id

Index: `user_id`.

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

- id
- project_id
- version_type
- revision_number
- document_id
- document_number
- document_date
- effective_date
- previous_version_id
- status
- total_before_tax
- total_tax
- total_value
- approved_by
- approved_at
- created_at
- updated_at

version_type:
- CONTRACT
- MC0
- ADDENDUM

### work_items

Permanent project work identity.

- id
- project_id
- internal_code
- canonical_description
- created_at

### rab_version_items

- id
- rab_version_id
- work_item_id nullable for non-trackable structural rows
- parent_item_id
- sort_order
- row_type
- display_number
- description
- volume
- unit
- analysis_version_id
- unit_price
- tax_percent
- unit_price_with_tax
- subtotal
- weight
- change_type
- previous_version_item_id
- is_progress_trackable

change_type:
- UNCHANGED
- MODIFIED
- NEW
- REMOVED

row_type:
- SECTION
- SUBSECTION
- PARENT_ITEM
- ITEM
- SUBTOTAL
- TOTAL

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

- id
- project_id
- week_number
- start_date
- end_date
- status
- created_at

Unique:
- project_id + week_number

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

Periode 4 minggu/28 hari.

- id
- project_id
- period_number
- start_date
- end_date
- first_week_number
- last_week_number
- number_of_days
- status

### report_period_weeks

- report_period_id
- week_id

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
