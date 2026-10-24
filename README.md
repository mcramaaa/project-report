# Laporan Proyek

Starter repository dan kumpulan spesifikasi untuk aplikasi laporan progres proyek konstruksi.

## Tujuan

Aplikasi ini menggantikan alur kerja Excel yang tersebar menjadi satu sistem terstruktur:

- Kontrak -> MC-0 -> Addendum sebagai versi baseline.
- Progress aktual tetap utuh walaupun baseline berubah.
- Input progres mingguan menghasilkan alokasi harian.
- Laporan harian, mingguan, dan periode 4 minggu dibentuk dari satu sumber data.
- RAB/AHSP dapat diekstrak AI dari Excel/PDF, tetapi selalu melalui validasi dan approval manusia.
- Laporan final disimpan sebagai snapshot agar tidak berubah karena data di masa depan.
- Excel, PDF, dan PPTX menjadi output, bukan sumber kebenaran utama.

## Baca Sebelum Coding

Urutan dokumen:

1. `AGENTS.md`
2. `docs/PRD.md`
3. `docs/DECISIONS.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DATABASE.md`
6. `docs/API.md`
7. `docs/UI_UX.md`
8. `docs/AI_EXTRACTION.md`
9. `docs/EXCEL_MAPPING.md`
10. `docs/ACCEPTANCE_TESTS.md`
11. `docs/ROADMAP.md`
12. `docs/VIBE_CODING_GUIDE.md`

## Stack yang Diputuskan

- Monorepo: npm workspaces
- Frontend: Next.js + TypeScript + Tailwind
- Backend: NestJS + TypeScript + REST API
- Database: MySQL
- ORM: Prisma
- Kalkulasi: package terpisah `packages/calc`
- AI: melalui 9router dari backend saja
- Akses luar: Cloudflare Tunnel setelah aplikasi lokal stabil

## Folder

```text
apps/web
apps/api
packages/calc
packages/shared
packages/config
prisma
storage
docs
```

## Status

Repository ini adalah starter/specification pack untuk vibe coding. Implementasi aplikasi belum dibuat.
