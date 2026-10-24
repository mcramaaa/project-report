# Security Notes

## Authentication

- password hash
- HTTP-only cookie
- session expiry
- session revoke
- login throttling

## Authorization

Periksa di API:

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
