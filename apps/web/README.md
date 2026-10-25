# apps/web

Next.js (App Router) + TypeScript + Tailwind. Port default `3000`.

Frontend hanya membantu UX; authorization tetap di `apps/api`.

- Browser hanya bicara dengan web. `/api/*` di-rewrite ke `API_URL` (default `http://localhost:3001`) sehingga cookie session first-party (D-031). Rewrite dievaluasi saat build.
- Server component memanggil API langsung dengan meneruskan cookie (`lib/server-api.ts`); client component memakai `lib/api.ts`.
- Halaman: `/login`, `/`, `/projects/new`, `/projects/[projectId]` (tab `?tab=calendar|team`), `/profile`, `/admin/users`, `/admin/users/[userId]`, `/admin/roles`, `/admin/roles/[roleId]`, `/admin/projects`, `/admin/projects/[projectId]/members`.
- RAB: `/projects/[projectId]/rab`, `/projects/[projectId]/rab/[versionId]` (grid + editor draft), `/projects/[projectId]/rab/compare?base=&target=`. Angka ditampilkan dari decimal string tanpa konversi float (`formatNumber`); pilihan kolom grid disimpan per browser.
- Analisa ada di dalam Lihat RAB: `/projects/[projectId]/rab/[versionId]/analyses` dan detail `.../analyses/[analysisId]`. Tab Rekap RAB / Analisa / Bahan / Alat / Upah mempertahankan konteks paket. URL analisa lama dengan versi eksplisit diarahkan ke lokasi baru; tanpa versi menuju daftar versi RAB.
- Daftar proyek memakai query `?search=&page=` yang dirender server (`components/pager.tsx`).
- Pratinjau jadwal (`components/calendar-preview.tsx`) memakai `@laporan-proyek/calc`, perhitungan yang sama dengan backend.
- Lint memakai ESLint langsung (`next lint` sudah dihapus di Next.js 16).

## UI

Tampilan mengikuti OLMAT v2 Backoffice: ice blue, panel putih, sidebar terang,
menu aktif biru, dan shadow ringan. Token dan layout ada di `app/globals.css`;
komponen umum di `components/ui.tsx`, navigasi responsif di `components/app-shell.tsx`.
Tidak ada dependency runtime atau asset yang diambil dari proyek OLMAT.

- Desktop: sidebar dan breadcrumb. Mobile: drawer native dialog dan navigasi bawah.
- Tabel pengguna dan anggota menjadi kartu berlabel pada layar di bawah 768px;
  role tabel ditulis eksplisit agar struktur aksesibilitas tetap tersedia.
- Login mendukung tampil/sembunyikan password. Navigasi hanya memuat fitur tersedia.
- Verifikasi UI dengan akun system admin dan anggota biasa, keyboard, serta viewport
  desktop/mobile. Pastikan menu aktif, Escape menutup drawer, tidak ada scroll
  horizontal halaman, dan state kosong/error tetap terbaca.
- Bila Turbopack diblokir lingkungan yang melarang bind port, build web dapat
  diverifikasi menggunakan `npm run build -w @laporan-proyek/web -- --webpack`.

Klik nilai bergaris putus-putus untuk membuka **Asal nilai**: nilai lengkap,
rumus, operand dan tautan rinci. Sumber Excel dibuka dalam pratinjau sheet
(izin `document.read`); nilai cached tidak dihitung ulang. Baris tujuan disorot.
