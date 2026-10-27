# Koreksi RAB dan Sumber Nilai (D-068)

Disetujui pengguna 26 Oktober 2026: buka kembali versi RAB yang sama, simpan
snapshot lama, wajib alasan dan audit, lalu approval ulang. Role berlaku
pada proyek yang ditugaskan, bukan akses global.

## Alur dan otorisasi

- Role proyek bawaan baru `RAB_EDITOR` (Editor RAB): membaca proyek/RAB/dokumen,
  mengelola draft, membuka kembali RAB, mengedit sumber AHSP dan pemetaan
  pekerjaan, serta approve RAB. Tidak memberi administrasi user atau akses
  proyek lain. Permission adalah boundary backend; nama role bukan bypass.
- Permission baru `rab.reopen` dan `ahsp.edit`. Role lain tidak otomatis
  mendapat permission baru. Super admin mengikuti katalog permission seperti
  sebelumnya. Role dapat ditugaskan melalui manajemen akses proyek yang ada.
- `APPROVED -> REOPENED -> APPROVED`, tetap id/jenis/nomor baseline yang sama.
  Reopen wajib alasan, proyek ACTIVE, dan tidak boleh bersamaan dengan draft
  atau koreksi RAB lain pada proyek itu. Perubahan sumber di REOPENED
  memerlukan hak koreksi; membuka kunci tidak memberi user lain akses baru.
- REOPENED dapat memakai editor RAB yang ada; approve ulang menjalankan seluruh
  validasi dan warning. Versi REOPENED tidak boleh di-discard sebagai draft
  baru karena versi itu sudah mempunyai histori approved.
- Kontrak/MC-0/Addendum tetap diurutkan menurut urutan domain, bukan waktu
  approval terakhir. Approval ulang Kontrak tidak menggeser MC-0/Addendum
  menjadi versi sebelumnya yang salah. Pembuatan versi/impor resmi baru
  ditahan selama ada REOPENED, sebagaimana satu draft per proyek.

## Snapshot dan histori

- Tambahkan arsip approval append-only per versi RAB: urutan, waktu/actor,
  payload JSON, checksum SHA-256. Payload meliputi identitas versi, seluruh
  baris/relasi WI/hierarki, snapshot angka, analisa/komponen/harga dan
  provenance yang dipakai. Decimal diserialisasi sebagai string.
- Saat pertama membuka versi approved lama yang belum diarsipkan, bekukan
  kondisi approved lengkap sebelum mengubah status atau data. Approval baru
  dan approval ulang menghasilkan arsip approved baru dalam transaksi yang
  sama. Arsip lama tidak ditulis ulang atau dihapus.
- Sediakan daftar dan tampilan snapshot lama (read-only, memerlukan `rab.read`
  dan `ahsp.read` karena payload lengkap berisi paket AHSP dan nilai sebelum/sesudah).
  Snapshot tidak dihitung ulang dari data live. Checksum memakai serialisasi
  deterministik, bukan urutan key JSON MySQL.
- Semua perubahan koreksi tercatat (actor, waktu, alasan, before/after).
  Reopen + snapshot + audit serta approval ulang + snapshot + audit atomik.
  Seluruh mutasi memakai urutan row lock yang konsisten dengan operasi RAB.
- Dokumen Excel asli, hash, draft impor dan keputusan review lama tetap utuh.
  Nilai yang diedit ditandai sebagai koreksi manual, bukan diklaim sebagai
  isi Excel asli. Provenance salinan dan akses ke snapshot asal harus tetap
  dapat ditelusuri meskipun versi sumber dikoreksi kemudian.
- Koreksi suatu versi tidak memperbarui paket versi lain, salinan turunannya,
  atau laporan final secara otomatis. Tidak mengimplementasikan laporan,
  baseline aktif, atau penghapusan histori dalam tugas ini.

## Edit dari sumber nilai

Rumus tetap mengikuti D-043/D-051. Hasil turunan tidak diedit langsung.

| Yang ingin dikoreksi | Input yang diubah |
|---|---|
| Volume/nama/satuan/PPN item | Item RAB pada versi yang editable |
| Harga pekerjaan dari analisa | Harga dasar, koefisien/komponen, overhead/pembulatan analisa |
| Harga pekerjaan langsung/manual | Harga langsung pada item RAB, dengan alasan |
| Harga komponen dari daftar harga | Harga dasar paket versi itu |
| Harga komponen manual | Harga manual komponen yang memang tidak tertaut harga/subanalisa |
| Identitas pekerjaan salah (WI) | Pilih WI pada versi sebelumnya yang sesuai, periksa duplikat dan perbarui relasi asal item |

- Edit harga dasar, koefisien, harga komponen manual, overhead dan aturan
  pembulatan dilayani endpoint backend berkonteks proyek+versi dan UI pada
  daftar harga/detail analisa. REOPENED wajib alasan perubahan; hak edit
  sumber juga dapat dipakai pada DRAFT yang belum pernah approved.
- Hitung dampak dalam paket yang sama: komponen -> analisa -> subanalisa
  pemakai -> harga item RAB yang bersumber ANALYSIS -> jumlah/bobot/total.
  Gunakan Decimal/fungsi murni di calc, dengan transaksi perubahan+audit.
- Pertahankan faktor konversi sumber (`/4`, `/8`, dst), serta EXACT/ROUNDED
  pada subanalisa. Jangan menganggap harga komponen selalu sama dengan harga
  dasar, atau menambahkan overhead yang tidak dipakai sumber.
- Jangan diam-diam menghapus override harga sumber yang sudah disetujui.
  Item SOURCE_OVERRIDE/DIRECT tidak berubah menjadi ANALYSIS otomatis.
  Selisih harga yang muncul dijelaskan, keputusan override tetap eksplisit.
- Rehitung hanya dependency yang terdampak; jangan mengubah angka sumber
  yang tidak diedit akibat keterbatasan presisi penyimpanan D-063. Harga RAB
  yang melebihi presisi 2 desimal harus diselesaikan secara eksplisit,
  bukan dibulatkan diam-diam. Siklus dependency dan relasi keluar paket ditolak.
- Koreksi WI bukan mengganti kode master global atau menghapus WI lama.
  Item tetap merujuk identitas proyek; WI pilihan harus sesuai versi asal dan
  tidak sudah dipakai item lain. Contoh MC-0 kWh meter dapat dicocokkan ke
  WI-0364 melalui koreksi resmi; WI-0417 dan snapshot sebelum koreksi tetap
  tersimpan. Tugas ini menyediakan fitur, tidak otomatis mengoreksi data user.

## Verifikasi wajib

Role/izin per proyek, pencabutan izin langsung berlaku; penolakan tanpa alasan,
proyek CLOSED, status tidak sesuai, koreksi bersamaan dan discard REOPENED.
Reopen + snapshot immutable + perubahan + approval ulang; lihat payload lama
setelah sumber diubah; tidak ada perubahan paket MC-0 ketika Kontrak dikoreksi.
Urutan Kontrak -> MC-0 -> Addendum setelah approval ulang versi lama.
Harga dasar/koefisien -> faktor konversi -> subanalisa EXACT/ROUNDED -> RAB,
override tetap, penolakan siklus/out-of-package, koreksi WI dan duplikat,
audit before/after. Migration baru non-destruktif; jangan seed/reset DB user.

## Implementasi (26 Oktober 2026)

- Migration `20261026120000_rab_reopen_corrections`: status `REOPENED`, tabel
  `rab_version_snapshots`, role sistem `RAB_EDITOR` + permission-nya. Tidak
  mengubah role lama, membership, atau data RAB yang ada.
- API: `POST …/reopen`, `GET …/history`, `GET …/snapshots/:id`,
  `POST …/items/:itemId/work-item`, `PATCH …/price-items/:id`,
  `…/components/:id`, `…/analysis-versions/:id` (lihat `docs/API.md`).
- Rekalkulasi: `recalculatePackage` di `packages/calc` (murni, Decimal). Hanya
  baris yang nilainya berubah yang ditulis. Faktor `/n`/`*n` dibaca dari
  `source_locator.factor` komponen.
- Pilihan teknis: hasil yang melebihi skala kolom atau harga item ANALYSIS > 2
  desimal ditolak (`409`) dengan rincian, bukan dibulatkan; harga komponen
  tertaut yang tidak terbukti berasal dari sumbernya (harga dasar × faktor,
  subanalisa EXACT/ROUNDED) ditolak agar tidak menebak rumus. Selama REOPENED,
  baris yang sudah ada saat approval terakhir tidak dapat dihapus (ubah
  isinya); baris yang ditambahkan selama koreksi boleh dihapus.
- UI: tombol "Buka kembali" + alasan, panel alasan koreksi pada editor RAB,
  "Ganti WI", "Approve ulang", tombol "Koreksi" pada tab Bahan/Upah/Alat dan
  detail analisa, badge "koreksi manual"/"dihitung ulang", halaman
  Riwayat & snapshot.
