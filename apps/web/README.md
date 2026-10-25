# apps/web

Next.js (App Router) + TypeScript + Tailwind. Port default `3000`.

Frontend hanya membantu UX; authorization tetap di `apps/api`.

- Browser hanya bicara dengan web. `/api/*` di-rewrite ke `API_URL` (default `http://localhost:3001`) sehingga cookie session first-party (D-031). Rewrite dievaluasi saat build.
- Server component memanggil API langsung dengan meneruskan cookie (`lib/server-api.ts`); client component memakai `lib/api.ts`.
- Halaman: `/login`, `/`, `/projects/[projectId]`, `/profile`, `/admin/users`, `/admin/projects`, `/admin/projects/[projectId]/members`.
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
