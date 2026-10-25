# Roadmap

## Milestone 0 - Repository & Tooling

Deliverables:
- npm workspaces
- AGENTS.md
- docs
- lint/typecheck/test commands
- Docker Compose
- env example

## Milestone 1 - MySQL + Prisma

- connect database
- base schema
- migrations
- seed admin/dev data

## Milestone 2 - Authentication & Users

- login/logout
- server session
- users
- project roles
- authorization guards

## Milestone 3 - Project Master

- project CRUD
- date/duration
- generated weeks
- generated 4-week periods
- project team

## Milestone 4 - Manual RAB

- RAB versions
- work item hierarchy
- single version grid
- compare grid
- manual create/edit draft
- approval flow

## Milestone 5 - AI Upload / Extraction / Review

- document upload
- storage
- Excel preprocessing
- 9router client
- structured extraction
- validation
- split review
- approval

## Milestone 6 - MC0 + Addendum + Baseline

- version compare
- item matching
- effective date
- baseline assignments
- mid-week segment support

## Milestone 7 - AHSP

- analysis master
- versions
- material/labor/equipment components
- link RAB items to AHSP

## Milestone 8 - Schedule + Weeks

- schedule versions
- planned weekly weights
- Kurva S inputs
- baseline/schedule mapping

## Milestone 9 - Weekly Progress

- grid
- volume mode
- percentage cumulative mode
- validation
- cumulative
- remaining

## Milestone 10 - Daily Allocation

- factors
- schedule allocation
- manual
- rounding exactness

## Milestone 11 - Daily Reports

- work items
- labor
- material
- equipment
- weather
- preview

## Milestone 12 - Weekly & 4-Week Reports

- weekly rekap/detail
- Kurva S
- 4-week aggregation
- change-baseline notes

## Milestone 13 - Finalization / Snapshot / Audit

- review
- warning/error
- snapshot
- checksum
- reopen
- audit log

## Milestone 14 - Excel / PDF

- office-style export
- no external workbook dependency
- snapshot-based final exports

## Milestone 15 - PPTX

- editable charts/tables where possible
- final snapshot only

## Milestone 16 - Deployment Hardening

- Cloudflare Tunnel
- HTTPS
- backup jobs
- restore test
- access logs
- upload hardening
- login rate limit per IP dari IP klien tepercaya (Cloudflare), lalu aktifkan `trust proxy` sesuai hop (D-030)
