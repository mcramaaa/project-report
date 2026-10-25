Besok buka terminal WSL di folder proyek, lalu:

git pull origin main
npm ci

Pastikan .env, backup MySQL, dan file upload sudah dipulihkan mengikuti docs/HANDOFF.md. Jika belum, minta agen membantu restore terlebih dahulu. Jangan reset atau seed ulang database hasil restore.

Setelah lingkungan dan data siap:

docker compose up -d --wait
npm run db:migrate
npm run dev

Buka aplikasi di http://localhost:3000.

Lalu buka Codex dan Claude dari folder proyek itu. Kirim instruksi yang sama ke keduanya:

Saya melanjutkan proyek di WSL PC kantor.

Baca AGENTS.md, docs/HANDOFF.md, docs/HANDOFF_CODEX.md,
docs/PRD.md dan docs/DECISIONS.md.

Periksa git status, lingkungan WSL, koneksi database,
migration, dan keberadaan dokumen upload/workbook sumber.
Jangan reset database, seed ulang, atau menimpa perubahan lokal.

Laporkan kondisi yang sudah siap dan yang masih kurang.
Setelah siap, lanjutkan pekerjaan RAB yang tersisa sesuai
handoff. Belum lanjut ke baseline, progres atau laporan.

Beri satu agen tugas implementasi dan agen lainnya tugas review, agar keduanya tidak mengedit file yang sama bersamaan.
