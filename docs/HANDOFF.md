# Handoff: Ubuntu laptop ⇄ WSL PC kantor

Dokumen ini tidak memuat password, token, atau isi `.env`.
Baca juga `docs/HANDOFF_CODEX.md` untuk catatan sesi Codex dan
`docs/AI_ENGINEERING_STANDARDS.md` untuk standar kerja frontend/backend.

## 0a. Sesi PC kantor (WSL), 2026-10-28

### Yang berubah

- **Pratinjau Excel**
  - Cache 2 workbook terakhir di API.
  - Tautan "Kembali ke RAB / review impor" (via `Referer`/`?from=`).
  - Locator baris RAB membuka sel volume/uraian (`rab-parser@5`, impor baru
    saja).
- **Rekonsiliasi per item** tampil di dialog Harga + PPN dan Jumlah.
- **Workspace RAB ditata ulang** (`docs/UI_UX.md`, "Penataan ulang
  2026-10-28"):
  - satu header (judul `RAB …` + badge status, tab di bawahnya);
  - kartu ringkasan dokumen dan total;
  - Pemeriksaan dan Approval berdampingan;
  - daftar Analisa/Bahan/Alat/Upah dengan toolbar + pencarian, dan kartu
    ringkas di HP.
- **Koreksi tanpa dialog:**
  - pensil di samping nilai mengubahnya menjadi input di sel itu (harga dasar,
    koefisien, harga manual, overhead, pembulatan);
  - alasan ada di sel tersebut;
  - konfirmasi reopen/hapus memakai form inline.
- **Satuan:** detail analisa menampilkan "dasar Rp X/satuan ÷ faktor →
  /satuan", dengan tanda amber untuk satuan yang tidak konsisten. Konversi
  tidak ditebak.
- **Drag urutan** langsung tersimpan, juga saat REOPENED (tanpa alasan, tetap
  diaudit; catatan di D-068).
- **D-070 Batalkan koreksi:**
  - `POST /rab-versions/:id/cancel-correction { reason }` mengembalikan versi
    REOPENED persis ke snapshot approved terakhir (diverifikasi checksum),
    lalu status APPROVED.
  - Tombol ada di kartu ringkasan RAB.
- **Penanda status** "koreksi manual / dihitung ulang / override / langsung"
  menjadi ikon + tooltip (`components/info-hint.tsx`).
- DTO detail analisa kini memuat `priceItem.unit`. Jalankan `npm run
  build:packages` setelah pull.

### Checks (2026-10-28)

- API: typecheck dan lint bersih.
  - `vitest` `src/rab` 33/33 dan `src/imports` lulus.
  - Suite penuh sempat 4 gagal acak (error Prisma, berbeda tiap putaran) dan
    lulus bila diulang.
  - Test "baris approved tidak bisa dihapus" sesekali gagal karena cek waktu
    pembuatan (`wasApproved`); sudah ada sebelum sesi ini.
- Web: typecheck dan lint bersih. `next build` lulus di awal sesi, belum diulang
  setelah perubahan UI (dev server hidup).
- Playwright 1440/390 px: tanpa scroll horizontal dan tanpa error console.
- Status data dev saat commit:
  - RAB **Kontrak** SDSerangan sedang REOPENED (dikoreksi pengguna);
  - MC-0 APPROVED.

### Berikutnya

1. `npm run build -w @laporan-proyek/web` (next build) setelah perubahan UI.
2. ~~Faktor konversi dan satuan harga dasar dapat dikoreksi~~ selesai
   2026-10-28 (pensil di kolom Satuan dan di "÷ 8 → /OJ"). Data belum
   dikoreksi: Pipa PVC AW 4" (XXIII.6) dan Sock 20 mm (XXII.12) perlu dicek di
   workbook asli (satuan beda tanpa konversi).
3. Edit RAB di HP: form ubah baris masih di dalam kotak tabel yang bisa
   di-scroll.
4. Lanjutkan daftar "Berikutnya" di §0 di bawah (seed sample-ahsp, impor MC-n,
   audit §9 butir 5–8, M6).

## 0. Sesi PC kantor (WSL), 2026-10-27 → lanjut di laptop

### Yang berubah di sesi ini

- **UI mengikuti olmat-backoffice** (`docs/UI_UX.md` "Visual Direction"):
  `apps/web/app/globals.css` ditulis ulang menjadi satu set token (warna, skala
  teks, spacing, radius, bayangan); palet `slate` Tailwind disetel ke abu-abu
  OLMAT; font Inter dimuat lewat `next/font`. Shell: sidebar kartu yang bisa
  diringkas, topbar dengan menu akun (Profil/Keluar), drawer + bottom nav di
  mobile. `PageTitle` kini punya `eyebrow`/`actions`/`back`; komponen baru
  `Section`. Ukuran ±8% lebih kecil, tanpa `max-width` sehingga mengisi layar
  saat zoom out Chrome. Halaman pengguna memakai menu ⋯ untuk aksi jarang.
- **D-069 dokumen RAB = Kontrak + MC-0 … MC-100**, Addendum dihapus. Nomor MC
  dipilih pengguna, boleh meloncat asal naik (MC-0, MC-1, MC-30, …, MC-100).
  Impor menyimpan nomor MC (`rab_imports.target_revision_number`) untuk memilih
  blok "MC - n". `rab-import-guide@4`, `rab-parser@4`.
- **Tanggal efektif MC** mengikuti D-020 (default minggu berikutnya; tanggal
  pasti bila dokumen resmi mewajibkan). OD-013 ditutup. Diterapkan saat M6.
- Bug: kartu kosong di bawah review impor yang sudah approved dihilangkan.

### Mulai di laptop

1. `git pull` lalu `npm ci` (dependensi tidak berubah di sesi ini, tetapi aman).
2. `npm run build:packages` (prisma generate + build `calc`/`shared`).
3. **Wajib:** `npx prisma migrate deploy`. Migration yang belum ada di database
   laptop: `20261026100000_soft_delete_rab_import`,
   `20261026120000_rab_reopen_corrections`, `20261027120000_rab_mc_versions`.
   Yang terakhir mengubah MC0 → MC 0 dan ADDENDUM n → MC n (data tetap).
   Jika laptop memakai dump PC kantor yang lebih baru, migration yang sudah
   tercatat dilewati otomatis.
4. `npm run dev`. Di PC kantor port 3000 dipakai WhatsApp bridge Hermes, jadi
   web dijalankan manual di 3100 (`cd apps/web && npx next dev --port 3100`);
   origin CSRF API tetap `APP_URL`. Di laptop biasanya tidak perlu.
5. Graph graphify tidak di-commit (`graphify-out/` di-ignore, 13 MB).
   Bangun ulang: `graphify update .` (kode, gratis) atau `/graphify` di Claude
   Code untuk menyertakan dokumen.
6. `.claude/` dan `.codex/` tetap lokal (lihat §4). `.claude/CLAUDE.md` di PC
   kantor hanya berisi: baca `docs/AI_ENGINEERING_STANDARDS.md` sebelum kerja
   frontend/backend, dan pemakaian skill graphify.

### Hasil checks terakhir (PC kantor, 2026-10-27)

- API `vitest run`: 162 lulus, 6 skip (butuh workbook kantor di `storage/temp`:
  seed `db:seed:sample-ahsp` dan workbook asli belum dijalankan dengan D-069).
- Typecheck API + web bersih; ESLint API + web bersih; `prisma migrate diff`
  migrations ↔ schema: tidak ada selisih.
- UI diperiksa dengan Playwright (screenshot 1440/2160/390 px; alur sidebar
  ringkas, menu akun, drawer, menu ⋯, logout; tanpa scroll horizontal di HP).
- **Belum dijalankan:** `next build` (bentrok dengan dev server yang hidup).
  Jalankan `npm run build -w @laporan-proyek/web` sebelum deploy.

### Berikutnya (urut prioritas)

Update 2026-10-28: `next build` web lulus; audit §9 butir 1–4 selesai
(`rab-parser@5`). `storage/temp` di mesin ini kosong, jadi seed sample-ahsp
belum bisa dijalankan.

1. Seed `db:seed:sample-ahsp` dengan workbook kantor untuk memverifikasi D-069
   (kini membuat MC-1, bukan Addendum 1).
2. Uji impor MC bernomor selain 0 dengan workbook yang punya blok "MC - n".
3. Sisa audit RAB di §9 (butir 5–8; butir 4 selesai). UI koreksi: lihat §0a.
4. Rapikan bagian dalam RAB editor & review impor ke komponen baru
   (`Section`, `PageTitle actions`); halaman lain sudah ikut token baru.
5. M6 baseline per periode memakai D-069 (tanggal efektif MC), lalu M8–M9.
   Ajukan OD-003, OD-004, OD-006, OD-008 dengan rekomendasi sebelum mulai.

---

Bagian di bawah ini catatan handoff sebelumnya (laptop → PC kantor, 2026-10-26).

## 1. Progres

| Milestone (docs/ROADMAP.md)                                                            | Status                                                                                 |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| M0 Repository & tooling                                                                | selesai                                                                                |
| M1 MySQL + Prisma                                                                      | selesai                                                                                |
| M2 Auth & users (role dinamis, super admin, akses per proyek)                          | selesai                                                                                |
| M3 Project master (status, kalender minggu/periode)                                    | selesai                                                                                |
| M4 RAB manual (versi, hierarki, grid, compare, approval)                               | selesai                                                                                |
| M5 Upload/ekstraksi/review impor RAB (deterministik + AI 9router sebagai kandidat)     | selesai                                                                                |
| M7 AHSP (analisa, harga bahan/upah/alat, paket per versi RAB)                          | selesai                                                                                |
| M6 MC + baseline (D-069: Kontrak + MC-0 … MC-100)                                      | sebagian: versi MC bernomor, impor MC, pewarisan paket; baseline per periode belum     |
| M8–M16 (jadwal lanjutan, progres, alokasi harian, laporan, finalisasi, export, deploy) | belum dimulai                                                                          |

Fokus terakhir: audit pemuatan RAB proyek contoh `SDN2-SERANGAN-2026-PAKET` terhadap
workbook kantor. Kontrak dan MC-0 cocok per item (416/416) dan total (D-063).
Jangan lanjut ke progres/laporan sebelum diputuskan pengguna.

## 2. Keputusan

Semua keputusan ada di `docs/DECISIONS.md` (D-001 … D-069). Yang paling menentukan untuk RAB:

- D-043 rumus RAB mengikuti workbook (PPN per item, REAL COST, DIBULATKAN, bobot).
- D-051 harga satuan analisa (D + overhead per versi analisa, pembulatan sumber).
- D-054 toleransi rekonsiliasi cached Excel: absolut Rp 0,000001.
- D-056–D-058 paket analisa/harga milik tiap versi RAB; MC mewarisi lewat salinan.
- D-068 role Editor RAB, reopen dan koreksi dari sumber.
- D-069 Kontrak + MC-0 … MC-100 (nomor boleh meloncat), tanggal efektif MC ikut D-020.
- D-059–D-062 navigasi dan asal nilai di dalam Lihat RAB.
- D-063 rekonsiliasi per item/total, WARNING `OVERHEAD_UNUSED`, keterbatasan presisi 12 desimal.
- D-064 klik asal nilai hanya untuk RAB dan pendukungnya.

Keputusan terbuka yang masih berlaku: OD-003, OD-004, OD-005, OD-006,
OD-008 (izin fitur mendatang), OD-010 (TKDN). Ajukan dengan rekomendasi sebelum
milestone terkait.

## 3. Commit

- Branch `main`, HEAD saat handoff dibuat: lihat `git log -1` (commit handoff ini, di atas `3160ef8`).
- `origin` = `git@github.com:mcramaaa/project-report.git`. Remote hanya berisi commit awal `fff60d1`;
  semua commit setelahnya (29 commit) **belum di-push saat handoff awal dibuat**.
  Pengguna kemudian mengizinkan commit dan push ke origin/main. Untuk status
  terbaru, jalankan `git fetch origin` dan `git status -sb`; clone GitHub dapat
  dipakai setelah push berhasil. Bundle pada bagian 6 tetap merupakan snapshot
  saat dibuat dan tidak otomatis memuat commit handoff Codex yang lebih baru.
- Commit terakhir:
  - `3160ef8` Value provenance limited to RAB and its supporting figures (D-064, Codex)
  - `581c7a8` RAB view: package tabs, value provenance (D-059–D-062); source reconciliation audit (D-063)
  - `d6c8d17` Analysis/price packages owned by each RAB version (D-056, D-057, D-058)

## 4. Perubahan belum di-commit (sengaja)

- `package.json`, `package-lock.json`: devDependency `prettier` 3.9.10 (milik Codex).
- `.prettierrc` (untracked, milik Codex).
- `.claude/` (konfigurasi lokal Claude Code, jangan di-commit).

Ketiga file Prettier dibawa sebagai patch terpisah (bagian 6); terapkan hanya bila disetujui.

## 5. Hasil checks terakhir (laptop, 2026-10-26)

`npm run lint` lulus, `npm run typecheck` lulus, `npm test` lulus (calc 43, api 136), `npm run build` lulus.
Test api memakai database `laporan_proyek_test` (di-reset oleh test) dan workbook di
`storage/temp` (spec workbook nyata dilewati bila file tidak ada).

## 6. Paket yang dibawa (di luar Git)

Folder laptop: `/home/mchrama/project-report-handoff-2026-10-26/`

| File                                                       | Isi                                                                                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `repo/project-report.bundle`                               | git bundle seluruh riwayat `main` (termasuk commit belum di-push)                                                          |
| `repo/uncommitted-prettier.patch`, `repo/.prettierrc`      | perubahan Prettier Codex yang belum di-commit                                                                              |
| `db/laporan_proyek-2026-10-26.sql.gz`                      | mysqldump database dev `laporan_proyek` (24 tabel; diverifikasi lewat restore ke database sementara, jumlah baris identik) |
| `storage/storage-2026-10-26.tar.gz` + `storage/SHA256SUMS` | 4 dokumen upload yang dirujuk DB dev + 5 workbook sumber `storage/temp`                                                    |

Dibawa terpisah dan diperlakukan rahasia: file `.env` dari root repo laptop.
Database `_test` dan `_shadow` tidak dibackup (dibuat ulang oleh `docker/mysql/init`).

Isi storage:

- `storage/projects/01a173ab-…/documents/` (proyek `SDN2-SERANGAN-2026-AHSP`): workbook 00 dan 04.
- `storage/projects/01a173f0-…/documents/` (proyek `SDN2-SERANGAN-2026-PAKET`): workbook 00 dan 04.
- `storage/temp/`: `00. RAB PENAWARAN`, `03 LAPORAN HARIAN`, `04. LAPORAN MINGGUAN`,
  `05. LAPORAN BULANAN`, `06. MC0 - BACK UP DATA QUANTITY` (data kantor; tidak boleh masuk Git).
- Tidak dibawa: `storage/projects/01a1744e-…` dan `01a1746c-…`, sisa seed uji ke database test.
  Keduanya tidak dirujuk database dev.

## 7. Restore di WSL

Simpan proyek di filesystem Linux WSL (`~/project/project-report`), bukan di `/mnt/c`.

1. **WSL dan Docker**: WSL2 Ubuntu. Docker Desktop dengan WSL integration aktif,
   atau Docker Engine di dalam WSL. Laptop: Docker 29.5.2, Compose v5.1.4, image `mysql:8.4` (8.4.11).
2. **Node**: Node 24 (laptop v24.21.0, npm 11.19.0; `engines` `>=24 <25`).
   Contoh: `nvm install 24 && nvm use 24`. Gunakan npm saja.
3. **Repo**:
   ```bash
   mkdir -p ~/project && cd ~/project
   git clone /path/ke/project-report.bundle project-report
   cd project-report
   git remote set-url origin git@github.com:mcramaaa/project-report.git
   git log --oneline -3      # pastikan HEAD sama dengan laptop
   # opsional, bila disetujui: git apply /path/ke/uncommitted-prettier.patch && cp /path/ke/.prettierrc .
   ```
4. **Env**: salin `.env` laptop ke root repo (`chmod 600 .env`), atau `cp .env.example .env` lalu isi.
   Variabel: `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `DATABASE_URL`, `SHADOW_DATABASE_URL`,
   `APP_URL` (http://localhost:3000), `API_URL` (http://localhost:3001), `PORT` (3001),
   `SESSION_TTL_HOURS`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD`,
   `STORAGE_ROOT`, `NINEROUTER_BASE_URL` (http://localhost:20128/v1), `NINEROUTER_API_KEY`,
   `AI_MODEL`, `AI_FALLBACK_MODEL`. Password MySQL hanya berlaku saat volume dibuat pertama kali.
   Laptop masih memakai password bawaan compose; sebaiknya ganti sebelum volume baru dibuat,
   lalu sesuaikan `DATABASE_URL`/`SHADOW_DATABASE_URL`.
5. **MySQL**:
   ```bash
   docker compose up -d --wait      # membuat laporan_proyek, _test, _shadow
   zcat /path/ke/laporan_proyek-2026-10-26.sql.gz \
     | docker exec -i -e MYSQL_PWD="<MYSQL_ROOT_PASSWORD>" laporan-proyek-mysql mysql -uroot
   ```
   Lakukan hanya pada database baru/kosong; dump memakai `DROP TABLE IF EXISTS`.
6. **Storage**:
   ```bash
   tar -xzf /path/ke/storage-2026-10-26.tar.gz      # dari root repo
   sha256sum -c /path/ke/SHA256SUMS                 # semua harus OK
   ```
7. **Dependency dan cek**:
   ```bash
   npm ci
   npm run db:migrate    # harus melaporkan tidak ada migration tertunda (8 migration)
   npm run lint && npm run typecheck && npm test && npm run build
   ```
8. **Menjalankan**: `npm run dev` → web http://localhost:3000, API http://localhost:3001.
   Login dengan super admin yang sudah ada di dump (kredensial sama seperti di laptop).
   Jangan menjalankan `npm run db:seed` atau `schema:drop` di database hasil restore kecuali memang perlu.
9. **AI (opsional)**: 9router harus berjalan di PC pada `NINEROUTER_BASE_URL`; uji dengan `npm run ai:ping`.
   Tanpa 9router, impor tetap jalan secara deterministik dan baris putus masuk review.
10. **VS Code**: buka WSL, `cd ~/project/project-report && code .` (ekstensi WSL).
    Port 3000/3001 otomatis bisa dibuka dari browser Windows.
11. **Git di WSL**: line ending LF (`git config core.autocrlf input`). Kunci SSH GitHub dibuat atau disalin
    ke `~/.ssh` WSL sebelum push. Push hanya setelah diputuskan.

Catatan pengujian browser yang dipakai selama ini: server uji di port bebas (API 3201 dengan
`APP_URL=http://localhost:3101`, web 3101). Rewrite `/api` Next dibaca saat build, jadi web uji
di-build dengan `API_URL=http://localhost:3201`, lalu dibangun ulang normal. Jangan mematikan proses
berdasarkan port, karena `npm run dev` milik pengguna juga berjalan.

## 8. Riwayat sesi asisten (tidak dibawa otomatis)

Riwayat memuat password MySQL lokal (terbaca saat sesi), jadi perlakukan sebagai rahasia.
Jangan menyalin seluruh `~/.claude`, `~/.claude.json`, atau `~/.codex`, karena berisi token akun
(`~/.codex/auth.json`, `config.toml`, kredensial Claude).

- Claude Code: `~/.claude/projects/-home-mchrama-project-project-report/`
  - `73b7f8f1-8097-4095-8055-fa6e2b5cd61f.jsonl` (sesi utama M0–D-064, ±26 MB),
    `87bffa8e-d0e6-460b-bc8c-6dfe9fb8367c.jsonl` (sesi awal).
  - `memory/` (5 catatan kerja: gate keputusan terbuka, kerja paralel Codex, workbook kantor,
    aturan mematikan proses). Aman disalin.
  - Nama folder mengikuti path proyek. Di PC dengan user `<user>` dan path `~/project/project-report`,
    foldernya menjadi `~/.claude/projects/-home-<user>-project-project-report/`.
    Salin `memory/` ke sana bila ingin catatan ini tetap dipakai.
- Codex: `~/.codex/sessions/2026/10/25/rollout-2026-10-25T12-42-59-01a1715e-79c5-7a10-b02f-32c9f3e06567.jsonl`
  (±13 MB, cwd proyek ini) dan entri terkait di `~/.codex/session_index.jsonl`.

## 9. Pekerjaan berikutnya

RAB (sisa dari audit):

1. ~~Cache workbook pratinjau Excel~~ selesai 2026-10-28: cache 2 file terakhir di proses API
   (file 8 MB: 6 dtk → ±5 ms saat dibuka ulang). Pembukaan pertama masih menahan event loop; pindah ke worker bila sering.
2. ~~Tautan kembali dari pratinjau Excel~~ selesai: memakai `Referer`/`?from=` (hanya path di proyek yang sama),
   label "Kembali ke RAB" / "Kembali ke review impor".
3. ~~Locator item hanya baris~~ selesai untuk impor baru (`rab-parser@5`): item membuka sel volume, judul membuka
   sel uraian. Data impor lama tetap membuka kolom A sampai diimpor ulang.
4. ~~Rekonsiliasi per item di dialog~~ selesai 2026-10-28: dialog Harga + PPN dan Jumlah item menampilkan nilai Excel
   saat impor (cocok/berbeda, selisih, toleransi). Item tanpa data (impor lama) diberi catatan.
5. Impor dengan `rab-parser@1` (data dev lama) tidak punya nilai cached item; rekonsiliasi per item "belum tersedia".
6. Presisi 12 desimal (D-063) belum dimigrasi; isolasi paket dijaga backend, belum oleh constraint DB.
7. Proyek lama `SDN2-SERANGAN-2026-AHSP`: 408 item MC-0 approved masih menautkan analisa Kontrak (legacy, tidak diubah).
8. MC-1 (dulu Addendum 1) di proyek PAKET tetap DRAFT, karena tidak ada workbook MC-1. TKDN ditunda (OD-010).

Setelah RAB dinyatakan selesai: M6 baseline per periode, lalu M8–M9 (jadwal, progres mingguan).
Ajukan OD-003, OD-004, OD-006 dan izin fitur (OD-008) sebelum mulai.
