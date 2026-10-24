# Vibe Coding Guide

Dokumen ini dibuat agar coding agent tidak mencoba membuat seluruh aplikasi sekaligus.

## Cara Memulai

Berikan agent:

> Baca AGENTS.md, docs/PRD.md, docs/DECISIONS.md, dan docs/ROADMAP.md. Kerjakan hanya Milestone 0. Jangan lanjut ke milestone lain. Setelah selesai, jalankan test/check yang relevan dan laporkan file yang berubah.

Setelah Milestone 0 stabil:

> Kerjakan hanya Milestone 1 berdasarkan docs/DATABASE.md. Jangan membuat fitur UI. Pastikan migration bersih dan dokumentasi sinkron.

Lanjutkan milestone per milestone.

## Prompt Pattern

Gunakan format:

```text
Baca:
- AGENTS.md
- docs/PRD.md
- docs/<dokumen relevan>

Task:
<task kecil yang konkret>

Constraints:
- jangan mengubah business rule
- jangan melompat ke milestone berikutnya
- update test
- update docs bila desain berubah
- gunakan npm

Definition of done:
<acceptance spesifik>
```

## Jangan Meminta Agent

Hindari prompt seperti:

> Buat seluruh aplikasi sesuai PRD.

Itu meningkatkan risiko:
- schema berubah-ubah
- auth setengah jadi
- business rule terduplikasi
- test tidak ada
- AI langsung menulis database
- baseline historis rusak

## Task Size yang Disarankan

Bagus:

- buat base Prisma schema users/projects
- buat week generator + tests
- buat pure daily allocation + tests
- buat RAB compare DTO
- buat upload document endpoint
- buat AI extraction state machine

Terlalu besar:

- buat semua RAB, progress, report dan AI sekaligus

## Gate Setiap Milestone

Sebelum lanjut:

- lint
- typecheck
- test
- build bila sudah tersedia
- migration check
- docs sync

## Business Rules yang Jangan Sampai Hilang

1. baseline versioned
2. progress actual tidak ditulis ulang
3. weeks berdasarkan start date
4. "monthly" = 4 minggu/28 hari
5. AI -> review -> approval
6. final report = snapshot
7. decimal-safe math
8. authorization backend
