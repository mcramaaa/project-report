# Deploy ke VPS Ubuntu

Satu VPS Ubuntu 24.04, domain dengan HTTPS. Susunan:

```
Internet ──443──> Caddy (HTTPS otomatis) ──> web :3000 ──/api──> api :3001 ──> MySQL :3306 (Docker, hanya 127.0.0.1)
```

Hanya port 22, 80, dan 443 yang terbuka ke internet. Contoh di bawah memakai domain
`laporan.domainanda.com` dan user Linux `laporan`; ganti sesuai milik Anda.

RAM: impor RAB membaca workbook ke memori (D-089): file 32 MB butuh ±0,6 GB heap, file 100 MB ±1,8 GB. Untuk menerima
file sampai batas 100 MB, pakai VPS dengan RAM ≥ 4 GB dan heap API 3 GB (langkah 6). Di VPS 2 GB, file di atas ±30 MB
akan gagal diimpor (API kehabisan memori), walaupun unggahnya sendiri berhasil.

## 1. Persiapan server (sekali)

Arahkan DNS dulu: buat record `A` `laporan.domainanda.com` ke IP VPS.

```bash
sudo apt update && sudo apt upgrade -y
sudo adduser --disabled-password --gecos "" laporan
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable

# Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git

# Docker (untuk MySQL)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker laporan

# Ekspor PDF dari file Excel kantor (D-086)
sudo apt install -y libreoffice-calc-nogui python3-uno

# Caddy (reverse proxy + sertifikat HTTPS otomatis)
sudo apt install -y caddy
```

Ubuntu 24.04 membatasi user namespace, padahal konversi PDF berjalan di dalam `unshare -rn`
(tanpa jaringan). Cek:

```bash
sudo -u laporan unshare -rn true && echo OK
```

Bila gagal ("Operation not permitted"), izinkan lalu cek lagi:

```bash
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-userns.conf
sudo sysctl --system
```

## 2. Kode

```bash
sudo -iu laporan
git clone https://github.com/mcramaaa/project-report.git app
cd app
git checkout main            # atau branch yang mau dipasang
```

Repo private: buat deploy key (`ssh-keygen -t ed25519`), tempel isi `~/.ssh/id_ed25519.pub` di
GitHub → repo → Settings → Deploy keys (read-only), lalu clone dengan
`git@github.com:mcramaaa/project-report.git`.

## 3. `.env`

```bash
cp .env.example .env
chmod 600 .env
openssl rand -base64 24      # jalankan 2x: untuk MYSQL_PASSWORD dan MYSQL_ROOT_PASSWORD
nano .env
```

Isi:

```ini
MYSQL_PASSWORD="<acak-1>"
MYSQL_ROOT_PASSWORD="<acak-2>"
DATABASE_URL="mysql://laporan:<acak-1>@127.0.0.1:3306/laporan_proyek"
APP_URL="https://laporan.domainanda.com"   # persis alamat yang dibuka pengguna; https = cookie Secure
API_URL="http://127.0.0.1:3001"
PORT=3001
NODE_ENV="production"
SEED_ADMIN_EMAIL="<email admin>"
SEED_ADMIN_NAME="<nama admin>"
SEED_ADMIN_PASSWORD="<password awal, min. 8>"
STORAGE_ROOT="/home/laporan/app/storage"
```

`SHADOW_DATABASE_URL` tidak dipakai di server. Variabel `NINEROUTER_*`/`AI_*` boleh kosong; tanpa
itu impor RAB berjalan tanpa usulan AI.

## 4. MySQL

MySQL hanya boleh didengar dari server sendiri. Docker melewati `ufw`, jadi kunci port lewat file
override (tidak masuk Git):

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  mysql:
    ports: !override
      - "127.0.0.1:3306:3306"
EOF
docker compose up -d --wait
```

## 5. Build, migrate, admin pertama

```bash
npm ci
npm run build                # API_URL dibaca saat build (proxy /api)
npm run db:migrate
npm run db:seed              # super admin dari SEED_ADMIN_*
```

Setelah login pertama, ganti password admin di **Profil & keamanan**, lalu hapus
`SEED_ADMIN_PASSWORD` dari `.env`. Seed contoh (`db:seed:dev`, `db:seed:sample*`) hanya untuk development.

## 6. Service systemd

Keluar dari user `laporan` (`exit`), lalu sebagai sudo:

```bash
sudo tee /etc/systemd/system/laporan-api.service >/dev/null <<'EOF'
[Unit]
Description=LaporanProyek API
After=network.target docker.service

[Service]
User=laporan
WorkingDirectory=/home/laporan/app/apps/api
Environment=NODE_ENV=production
# Heap untuk impor workbook besar (D-089): 3072 untuk file sampai 100 MB (RAM ≥ 4 GB); 1024 di VPS 2 GB.
Environment=NODE_OPTIONS=--max-old-space-size=3072
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/laporan-web.service >/dev/null <<'EOF'
[Unit]
Description=LaporanProyek web
After=laporan-api.service

[Service]
User=laporan
WorkingDirectory=/home/laporan/app/apps/web
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now laporan-api laporan-web
curl -s localhost:3001/api/health && curl -sI localhost:3000/login | head -1
```

Web berjalan di port 3000 (`next start --port 3000`), API di 3001.

## 7. Caddy (HTTPS)

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
laporan.domainanda.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
sudo systemctl reload caddy
```

Caddy mengambil sertifikat Let's Encrypt sendiri (DNS harus sudah mengarah ke VPS). Buka
`https://laporan.domainanda.com` dan login dengan admin dari langkah 5.

Caddy tidak membatasi ukuran body. Bila memakai nginx, batas unggah 100 MB (D-089) harus diizinkan di server block:
`client_max_body_size 100m;` dan `proxy_read_timeout 300s;` (impor file besar memakan waktu).

## 8. Update versi

```bash
sudo -iu laporan
cd app && git pull
npm ci && npm run build && npm run db:migrate
exit
sudo systemctl restart laporan-api laporan-web
```

Backup dulu sebelum update yang membawa migration (langkah 9).

## 9. Backup

Data ada di dua tempat: database dan folder `storage/` (file Excel, logo, foto KTP). Keduanya
harus dibackup bersama.

```bash
sudo -u laporan mkdir -p /home/laporan/backup
sudo tee /etc/cron.daily/laporan-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
cd /home/laporan/app
d=$(date +%F)
docker compose exec -T mysql sh -c 'mysqldump --single-transaction -uroot -p"$MYSQL_ROOT_PASSWORD" laporan_proyek' | gzip > /home/laporan/backup/db-$d.sql.gz
tar -czf /home/laporan/backup/storage-$d.tar.gz -C /home/laporan/app storage
find /home/laporan/backup -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/laporan-backup
```

Salin folder `backup` ke tempat lain secara berkala (komputer kantor atau penyimpanan cloud);
backup di VPS yang sama hilang bila VPS-nya hilang.

## Masalah umum

| Gejala | Penyebab |
|---|---|
| Login gagal "Origin request tidak diizinkan" | `APP_URL` tidak sama persis dengan alamat di browser (http/https, www, port). Ubah, lalu `npm run build` dan restart. |
| Halaman 502 | Service mati: `sudo journalctl -u laporan-web -u laporan-api -n 50`. |
| Ekspor PDF Excel kantor gagal | LibreOffice/python3-uno belum terpasang, atau `unshare -rn true` gagal (langkah 1). |
| `npm run build` gagal "Node" | Versi Node bukan 24: `node -v`. |
| Unggah RAB sampai 100% lalu gagal; `journalctl -u laporan-api` berisi `heap out of memory` / exit 134 | File terlalu besar untuk heap API: naikkan `--max-old-space-size` di service (langkah 6) dan RAM VPS, lihat D-089. |
| Unggah berhenti di 10 MB, log web "Request body exceeded 10MB" | Build web lama tanpa `proxyClientMaxBodySize`; `npm run build` ulang. Cek juga `client_max_body_size` nginx. |
