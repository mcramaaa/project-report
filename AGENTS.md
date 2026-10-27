# AGENTS.md

## Project

Aplikasi Laporan Progres Proyek konstruksi.

Sebelum membuat perubahan, baca:

1. `docs/PRD.md`
2. `docs/DECISIONS.md`
3. dokumen teknis yang relevan dengan task

Jika requirement tidak jelas, jangan membuat business rule baru secara diam-diam.

## Tooling Rules

- Gunakan `npm`.
- Jangan gunakan pnpm atau yarn.
- Gunakan npm workspaces.
- Frontend: Next.js + TypeScript.
- Backend: NestJS + TypeScript.
- Database: MySQL.
- ORM: Prisma.
- Semua source code utama menggunakan TypeScript.

## Core Business Rules

- Kontrak, MC-0, MC-1, … MC-100 adalah versi baseline berbeda (D-069).
- Jangan overwrite baseline lama.
- Progress aktual adalah fakta lapangan dan tidak hilang saat baseline berubah.
- Setiap minggu mengetahui baseline yang berlaku pada periode tersebut.
- Laporan final tidak boleh berubah otomatis.
- Jika laporan final perlu dikoreksi, lakukan reopen dengan alasan dan audit log.
- AI tidak boleh menulis hasil ekstraksi langsung ke RAB resmi.
- Hasil AI wajib melalui structured validation, business validation, review manusia, lalu approval.
- Angka uang, volume, koefisien, bobot, dan persentase kritis harus menggunakan decimal-safe arithmetic.
- Jangan menggunakan JavaScript floating point sebagai sumber perhitungan kritis.

## Architecture Rules

Monorepo:

- `apps/web`
- `apps/api`
- `packages/calc`
- `packages/shared`
- `packages/config`

`packages/calc` harus berisi fungsi perhitungan murni.

`packages/calc` tidak boleh mengakses:

- database
- filesystem
- HTTP
- AI
- environment variables aplikasi

## Database Rules

Setiap perubahan schema:

- update Prisma schema
- buat migration baru
- jangan mengedit migration yang sudah digunakan
- pertahankan histori proyek

Hindari hard delete untuk:

- RAB approved
- baseline
- progress
- laporan final
- audit log
- AI extraction yang sudah digunakan

## Security Rules

- Authorization selalu diperiksa di backend.
- Frontend hanya membantu UX; bukan boundary keamanan.
- Password di-hash dengan algoritma password hashing yang sesuai.
- Gunakan HTTP-only secure cookie untuk session.
- Secret tidak boleh masuk Git.
- 9router hanya dipanggil oleh backend.
- Endpoint AI lokal tidak diekspos ke publik.

## Testing Rules

Business calculation wajib memiliki unit test.

Skenario kritis wajib dites:

- perubahan Kontrak -> MC-0
- perubahan MC-0 -> MC-1 dst
- progress lama tidak berubah
- volume kumulatif tidak melebihi baseline
- daily allocation berjumlah tepat sama dengan weekly volume setelah rounding
- final report snapshot tidak berubah
- reviewer tidak boleh finalisasi laporan yang dia input sendiri

Sebelum task selesai, jalankan bila script tersedia:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## AI Extraction Flow

Flow wajib:

```text
Upload file
-> raw document saved
-> extraction
-> structured draft
-> schema validation
-> business validation
-> human review
-> approval
-> official RAB
```

Dilarang:

```text
Upload file
-> AI
-> official RAB langsung
```

## Coding Style

- Hindari duplikasi business rule.
- Gunakan nama domain yang jelas.
- Jangan membuat abstraction sebelum dibutuhkan.
- Pisahkan business logic dari controller/UI.
- Gunakan transaksi database untuk approval/finalization multi-step.
- Jangan menyimpan derived values yang mudah dihitung ulang kecuali snapshot/finalization memang membutuhkannya.

## Documentation Discipline

Jika business requirement berubah:

1. update `docs/PRD.md`
2. update `docs/DECISIONS.md` bila perlu
3. update schema/API
4. update tests
5. baru implementasi

## Before Finishing a Task

Periksa:

- PRD terpenuhi
- TypeScript tidak error
- test hijau
- migration valid
- authorization benar
- audit log dibuat bila diperlukan
- tidak ada secret masuk repository
- dokumentasi relevan diperbarui

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
