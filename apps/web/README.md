# apps/web

Next.js (App Router) + TypeScript + Tailwind. Port default `3000`.

Frontend hanya membantu UX; authorization tetap di `apps/api`.

- `npm run dev -w @laporan-proyek/web`
- `API_URL` (default `http://localhost:3001`) dipakai server-side untuk memanggil API.
- Lint memakai ESLint langsung (`next lint` sudah dihapus di Next.js 16).
