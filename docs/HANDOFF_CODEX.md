# Handoff Codex — project-report

Tanggal: 26 Oktober 2026. Catatan ini merangkum sesi Codex dan kondisi repo
saat dibuat; bukan ekspor lengkap percakapan dan bukan backup database.

## Mulai di PC kantor

1. Buka folder proyek di filesystem Linux WSL, misalnya
   `~/project/project-report`, lewat terminal atau VS Code yang terhubung ke WSL.
2. Baca `AGENTS.md`, dokumen ini, `docs/HANDOFF.md` (catatan Claude),
   `docs/PRD.md`, dan `docs/DECISIONS.md`. Periksa `git status` dan `git log`.
3. Jangan menganggap sesi lokal otomatis ikut saat clone Git atau login akun.
   Chat baru dapat melanjutkan dengan dokumen ini; riwayat penuh perlu
   dipindahkan/diakses melalui mekanisme sesi tool masing-masing.
4. Cocokkan kode, database, dan dokumen sumber yang dipindahkan sebelum
   melanjutkan pekerjaan. Git tidak membawa database maupun file yang diabaikan.

Instruksi pembuka yang dapat diberikan kepada Codex maupun Claude:

```text
Baca AGENTS.md, docs/HANDOFF_CODEX.md, docs/HANDOFF.md (catatan Claude),
docs/PRD.md dan docs/DECISIONS.md. Periksa keadaan repo saat ini terlebih
dahulu. Lanjutkan pekerjaan RAB yang tersisa; jangan membuat business rule
baru atau lanjut baseline/progres/laporan tanpa arahan pengguna.
```

## Keadaan kode yang diverifikasi

HEAD sebelum commit catatan Codex ini: `21ed4a9` — Docs: handoff from the
Ubuntu laptop to a WSL office PC. Kode terakhir: `3160ef8` (D-064).

Commit penting sebelumnya:

- `581c7a8`: UI/navigasi/provenance D-059–D-062 dan audit sumber D-063.
- `d6c8d17`: paket analisa/harga mandiri per versi RAB, D-056–D-058.

Perubahan kode UI yang dikerjakan Codex sudah berada dalam commit di atas.
Saat penulisan masih ada perubahan lokal lain:

- `package.json`, `package-lock.json` (konfigurasi/dependensi Prettier).
- `.prettierrc` dan `.claude/` belum terlacak Git.

Jangan ikut menambahkan, menghapus atau menimpa perubahan itu tanpa meninjau
isinya dan arahan pengguna. Pengguna sudah mengizinkan commit dan push. Remote `origin` sudah di-fetch;
sebelum push branch main memiliki 29 commit lokal di atas origin/main.
Gunakan `git log -1` dan `git status -sb` untuk status terbaru.

Catatan Claude tersedia sebagai `docs/HANDOFF.md`, sudah di-commit pada
`21ed4a9`. Baca bersama dokumen ini; tidak perlu menggandakan catatannya
dengan nama HANDOFF_CLAUDE.md.

## Fokus dan preferensi pengguna

Prioritas saat ini adalah RAB lengkap yang benar dan nyaman digunakan.
Belum lanjut aktivasi baseline, input progres, laporan, TKDN atau export.

- Kontrak/Penawaran, MC-0, setiap Addendum memiliki rekap, analisa, bahan,
  upah dan alat sendiri. Penggabungan lintas Struktur/Arsitektur/MEP hanya
  di dalam versi RAB yang sama, bukan master bersama antarversi.
- Jika MC-0/Addendum tidak menyediakan analisa, ambil dari versi approved
  sebelumnya melalui salinan dependency terpakai dengan provenance; jangan
  mengubah data asal atau membuat ketergantungan mutable bersama.
- Nama pekerjaan mengikuti rekap RAB. Pemetaan analisa ditelusuri dari rumus,
  bukan sekadar kemiripan nama. Impor hanya dependency yang benar-benar dipakai.
- Nilai resmi mengikuti rantai rumus RAB sumber yang disahkan, termasuk harga,
  volume, PPN dan pembulatan. Mesin aplikasi menghitung dengan Decimal.
  Cached Excel adalah pembanding, bukan pengganti kalkulasi aplikasi.
- Overhead tercantum namun tidak dipakai rumus cukup diberi warning informatif.
  Jangan menambahkan overhead diam-diam atau mengubah data approved.

Acuan rinci: D-043, D-045–D-058, D-063 dan `docs/RAB_IMPORT_GUIDE.md`.

## UI terakhir yang disepakati

Arah visual mengikuti OLMAT: panel putih, latar biru muda, aksen biru, tabel
terbaca, sidebar desktop, drawer dan navigasi bawah mobile. Build aplikasi
tidak bergantung pada direktori OLMAT.

- Menu manajemen akses di sidebar cukup **Pengguna**; role/permission dan
  akses proyek dibuka dari tab pada halaman manajemen pengguna.
- Lihat satu versi RAB hanya memiliki **satu tingkat tab**:
  Rekap RAB / Analisa / Bahan / Alat / Upah. Jangan mengulang tab proyek di
  atasnya. Ada tautan teks kembali ke proyek dan semua versi RAB (D-062).
- Analisa berada di dalam Lihat RAB, bukan tab tersendiri detail proyek.
- Detail analisa mengikuti lembar AHSP: A Tenaga, B Bahan, C Peralatan,
  koefisien, harga, jumlah, subtotal kelompok, D biaya langsung,
  E overhead/profit, F harga eksak dan pembulatan sumber. TKDN ditunda.
- Klik asal nilai hanya pada angka RAB dan pendukungnya: analisa, harga,
  perbandingan serta review impor RAB. **Informasi proyek, kontrak, SPMK,
  kalender dan pratinjau jadwal harus teks biasa**, tanpa garis sumber atau
  dialog Asal nilai (D-064, koreksi terbaru pengguna).
- Dialog Asal nilai menunjukkan nilai lengkap, rumus, operand dan sumber.
  Tautan mempertahankan versi, menyorot baris dan membuka induk yang diciutkan.
  Input manual/override dan sumber hilang dijelaskan jujur.
- Pratinjau Excel menunjukkan nilai cached/formula asli; tidak mengeksekusi
  rumus atau mengakses workbook eksternal. Akses tetap `document.read` di API.

Berkas UI kunci: `components/rab-tabs.tsx`, `components/source-value.tsx`,
`components/rab-resource-page.tsx`, `lib/value-source.ts`, halaman
`projects/[projectId]/rab/[versionId]/...`, dan `app/globals.css` di apps/web.

## Audit dan validasi terakhir

Codex menjalankan lint, typecheck, test dan build pada kode D-064: semuanya
lulus, dengan **43 test calc dan 136 test API**. Ini hasil sesi sebelumnya,
bukan pemeriksaan baru saat menulis dokumen ini.

QA browser memakai API fixture terisolasi (bukan bukti audit database dev)
pada desktop 1440 dan mobile 390. Mencakup navigasi satu tingkat, tautan
sumber hingga Excel, dialog/fokus keyboard, pembukaan kelompok diciutkan,
dan informasi proyek/kalender/pratinjau wizard yang menjadi teks biasa.

Pengguna menyampaikan laporan audit Claude untuk proyek contoh
`SDN2-SERANGAN-2026-PAKET`: Kontrak 416/416 dan MC-0 416/416 item cocok dengan
workbook. Tidak dilakukan audit ulang DB dalam turn handoff ini.

- Kontrak REAL COST: Rp5.121.250.896,48; DIBULATKAN: Rp5.121.250.896.
- MC-0 REAL COST: Rp5.121.250.896,53; DIBULATKAN: Rp5.121.250.896.
- VI.6, VIII.4, XXI.3 memakai D sesuai sumber; warning `OVERHEAD_UNUSED`.
- D-054: toleransi absolut rekonsiliasi Rp0,000001, bukan toleransi relatif.
- Presisi penyimpanan komponen 12 desimal dapat menimbulkan selisih sekitar
  Rp10^-9 terhadap perkalian operand tersimpan; perubahan presisi perlu
  keputusan/migration terpisah. Detail batas status float di D-063.
- Impor lama mungkin tidak punya rekonsiliasi per item. Jangan mengarang bukti.

Gunakan proyek `...-PAKET` untuk pemeriksaan isolasi. Proyek lama `...-AHSP`
memiliki relasi legacy lintas versi dan bukan bukti isolasi paket yang benar.

## Yang harus tersedia di WSL

- Node 24, npm workspaces, MySQL (README memakai Docker Compose), Git.
- Semua kode dan migration; `npm ci` bila lockfile yang dibawa konsisten.
- Backup database development dan `storage/projects` untuk file asli upload.
  Sertakan workbook `storage/temp` bila ingin audit/seed contoh dari sumber.
- `.env` dipindahkan secara privat atau disusun kembali dari `.env.example`.
  Jangan menyalin secret ke handoff/Git. Periksa host database sesuai WSL.
- Backend 9router perlu tersedia terpisah bila memakai AI. Endpoint contoh
  `.env.example` adalah `http://localhost:20128/v1`; localhost WSL dan host
  Windows belum tentu menunjuk service yang sama. Konfigurasi ulang sesuai
  tempat service benar-benar berjalan; jangan menebak alias model.

Perintah dasar: `npm run db:migrate` menerapkan migration; `npm run dev`
menjalankan web 3000 dan API 3001. Ikuti README dan panduan restore Claude.
Untuk database hasil restore, periksa histori migration sebelum tindakan lain.
Jangan reset DB atau seed ulang atas data restore tanpa kebutuhan yang jelas.

Dokumen/backup dalam `/tmp` tidak boleh menjadi satu-satunya salinan pindah
mesin. Script QA Codex di `/tmp/report-rab-navigation-qa.cjs` dan screenshot di
`/tmp/report-rab-modern-preview` adalah artefak lokal, tidak masuk Git; script
itu memakai Playwright dari checkout OLMAT lain di laptop. Jangan menganggap
script/dependensi/path absolut tersebut tersedia di PC kantor.

## Langkah berikutnya

1. Pastikan catatan Claude, backup MySQL, dokumen upload dan workbook ikut dibawa.
2. Di WSL, pulihkan lingkungan/data dan cocokkan HEAD serta perubahan lokal.
3. Jalankan checks proyek dan coba Lihat RAB pada proyek contoh `...-PAKET`.
4. Catatan Claude di `docs/HANDOFF.md` melaporkan waktu preview sekitar
   0,37 detik untuk workbook 00 dan 1,07 detik untuk 04, beserta dampak ke
   event loop. Angka ini belum diukur ulang oleh Codex; verifikasi di WSL
   sebelum memilih cache atau worker thread.
5. Laporkan kekurangan RAB yang nyata. Jangan lanjut milestone berikutnya
   atau mengubah business rule hanya berdasarkan asumsi.
