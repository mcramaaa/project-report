# Security Notes

## Authentication

- password hash: scrypt (D-030)
- HTTP-only cookie, `SameSite=Lax`, `Secure` di HTTPS (D-031)
- token session hanya disimpan sebagai SHA-256 hash
- session expiry (default 12 jam) dan revoke
- login throttling (per email dan per IP)
- pesan gagal login generik
- CSRF: request yang mengubah data wajib `Origin` yang sesuai
- session, user, dan membership dibaca ulang dari database setiap request

## Authorization

Periksa di API (matriks lengkap: `docs/PERMISSIONS.md`):

- system admin vs role proyek; tanpa bypass universal
- project role
- self-review restriction
- baseline activation permission
- reopen permission
- AI approval permission

## Files

- whitelist extension
- validate MIME
- max upload size
- safe generated filenames
- never trust client path
- store outside public web root
- hash files

## AI

- AI output untrusted
- schema validate
- business validate
- human approval
- secrets backend only
- no direct browser -> 9router

## Network

Production awal:

```text
Internet
-> Cloudflare Tunnel
-> app
```

Tidak membuka MySQL atau 9router ke internet.

## Audit

Log high-value actions:

- login failures bila dibutuhkan
- RAB approval
- baseline activation
- progress correction
- finalization
- reopen
- role changes

## Backup

Backup database + storage.

Lakukan restore test berkala; backup tanpa uji restore belum cukup.
