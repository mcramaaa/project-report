# apps/web

Next.js (App Router) + TypeScript + Tailwind. Port default `3000`.

Frontend hanya membantu UX; authorization tetap di `apps/api`.

- Browser hanya bicara dengan web. `/api/*` di-rewrite ke `API_URL` (default `http://localhost:3001`) sehingga cookie session first-party (D-031). Rewrite dievaluasi saat build.
- Server component memanggil API langsung dengan meneruskan cookie (`lib/server-api.ts`); client component memakai `lib/api.ts`.
- Halaman: `/login`, `/`, `/projects/[projectId]`, `/profile`, `/admin/users`, `/admin/projects`, `/admin/projects/[projectId]/members`.
- Lint memakai ESLint langsung (`next lint` sudah dihapus di Next.js 16).
