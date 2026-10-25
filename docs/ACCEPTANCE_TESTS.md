# Acceptance Tests

Gunakan ini sebagai checklist saat vibe coding.

## 0. Database & Seed (Milestone 1)

- [x] migration berjalan di database bersih
- [x] email unik secara case-insensitive (normalisasi + unique index)
- [x] token session disimpan sebagai hash
- [x] seed system admin dari environment
- [x] seed dijalankan ulang tidak mereset password akun yang ada
- [x] data development terpisah dari seed production

## 0b. Auth, User, Role (Milestone 2)

- [x] login benar berhasil; password salah, email tidak terdaftar, user nonaktif mendapat pesan yang sama
- [x] pembatasan percobaan login (per email; per IP menunggu Milestone 16, D-030)
- [x] session kedaluwarsa, logout, dan session dicabut ditolak
- [x] user nonaktif tidak bisa memakai session lama
- [x] ganti password: password lama wajib benar, semua session dicabut, password lama ditolak setelahnya
- [x] request mengubah data tanpa Origin yang sesuai ditolak
- [x] endpoint administrasi menolak user tanpa permission
- [x] super admin dapat membaca semua proyek tanpa membership (D-035)
- [x] pemegang permission administrasi tidak otomatis membaca data proyek
- [x] isolasi akses antarproyek
- [x] perubahan role dan pencabutan membership berlaku pada request berikutnya
- [x] membership ganda ditolak
- [x] super admin aktif terakhir tidak bisa dinonaktifkan/dicabut, termasuk pada request bersamaan
- [x] audit dibuat untuk aksi user/membership/password/session tanpa data rahasia
- [x] response user tidak berisi password hash/token
- [x] role sistem bawaan dengan `project.read`; kode/status terkunci
- [x] role baru dapat dibuat; kode unik
- [x] permission tidak dikenal atau beda scope ditolak
- [x] perubahan permission/status role berlaku pada request berikutnya
- [x] role nonaktif tidak dapat ditugaskan dan tidak memberi akses
- [x] delegasi: `users.*`, `roles.*`, `assignments.*` sesuai permission
- [x] delegasi tidak dapat menyentuh akun/status super admin, role administrasi, atau akses dirinya sendiri
- [x] pencabutan role administrasi berlaku pada request berikutnya
- [x] halaman akses user menampilkan role administrasi dan proyek yang dapat diakses
- [x] migration mempertahankan role membership yang sudah ada
- [x] daftar proyek hanya memuat proyek yang detailnya dapat dibuka (role aktif + `project.read`)
- [x] pemegang `assignments.manage` dapat mencari calon anggota tanpa `users.read`

## A. Project Setup

- [x] project dapat dibuat (wizard identitas, kontrak, SPMK)
- [x] tanggal selesai rencana dihitung dari start date + duration − 1 (inklusif)
- [x] weeks dibuat sebagai blok 7 hari; minggu terakhir dipotong pada tanggal selesai
- [x] report periods dibuat sebagai blok 4 minggu
- [x] periode terakhir dapat kurang dari 28 hari
- [x] durasi 1, 7, 8, 28, 29 hari, pergantian bulan/tahun, dan tahun kabisat
- [x] pembuat proyek menjadi MANAGER; pembuatan, membership, minggu/periode, dan audit atomik
- [x] pembuatan ditolak bila role MANAGER tidak memiliki `project.read`/`project.update`
- [x] perubahan jadwal wajib alasan, mempertahankan ID minggu/periode bernomor sama, dan diaudit
- [x] proyek CLOSED menolak perubahan identitas dan jadwal; tetap dapat dibaca
- [x] tutup/buka kembali wajib alasan dan diaudit
- [x] daftar proyek dengan pencarian dan pagination (user dan administrasi)
- [x] tim proyek tanpa email, memerlukan `project.read`

## B. RAB Versioning

- [x] CONTRACT dapat dibuat
- [x] MC0 membuat versi baru
- [x] ADDENDUM membuat versi baru
- [x] versi lama tidak di-overwrite (APPROVED terkunci)
- [x] compare menunjukkan NEW/MODIFIED/REMOVED/UNCHANGED
- [x] urutan versi linear dan hanya satu DRAFT per proyek
- [x] approve memvalidasi error dan meminta konfirmasi warning; total disimpan sebagai snapshot
- [x] discard wajib alasan; versi tidak dihapus
- [x] rumus harga+PPN, jumlah, total, REAL COST, DIBULATKAN, dan bobot sama dengan workbook kantor (D-043)
- [x] `rab.read`/`rab.edit`/`rab.approve` ditegakkan backend; proyek CLOSED menolak perubahan RAB
- [x] rumus diverifikasi dengan workbook kantor (OD-009 → D-043): seed contoh SDN 2 Serangan menghasilkan total Kontrak dan MC-0 yang sama dengan workbook

## C. Work Item Identity

- [x] item yang sama antar baseline tetap work_item_id yang sama
- [x] item baru mendapat work_item_id baru
- [x] kode work item tetap unik setelah WI-9999 (WI-10000, WI-10001, …)
- [x] perbandingan mendeteksi pindah kelompok tanpa menganggap ID salinan sebagai perubahan
- [x] angka versi approved sama persis dengan draft-nya (presisi > 20 digit)
- [ ] item removed tidak menghapus histori progress (progress di M9; work item tidak pernah dihapus)

## D. Baseline Change

Scenario:

```text
M1 CONTRACT
M2 CONTRACT
M3 MC0
```

- [ ] M1/M2 tetap CONTRACT
- [ ] M3 memakai MC0
- [ ] cumulative actual tetap utuh

Scenario Addendum:

```text
M1-M10 existing baseline
M11 ADDENDUM 1
```

- [ ] M1-M10 tidak dihitung ulang
- [ ] M11 memakai Addendum

## E. Weekly Progress

- [ ] volume week input bekerja
- [ ] cumulative percentage input bekerja
- [ ] actual_volume disimpan
- [ ] cumulative tidak boleh melebihi baseline
- [ ] negative ditolak
- [ ] bulk save bekerja

## F. Daily Allocation

Example:
- weekly volume 14
- total factor 7
- one day factor 1.2

Expected:
- day volume = 2.4

- [ ] sum all daily == weekly volume setelah rounding
- [ ] remainder rounding masuk hari aktif terakhir
- [ ] all-zero factors ditolak
- [ ] manual allocation total mismatch ditolak

## G. Materials

- [ ] calculated = daily volume * AHSP coefficient
- [ ] actual dapat berbeda
- [ ] calculated value tidak hilang saat actual override

## H. Reports

### Daily
- [ ] pekerjaan
- [ ] tenaga kerja
- [ ] material
- [ ] alat
- [ ] cuaca
- [ ] preview

### Weekly
- [ ] planned
- [ ] actual
- [ ] cumulative
- [ ] deviation
- [ ] baseline yang digunakan

### 4-Week
- [ ] B1 uses M1-M4
- [ ] B2 uses M5-M8
- [ ] no new progress input
- [ ] last short period supported

## I. Finalization

- [ ] error menahan finalisasi
- [ ] warning membutuhkan catatan
- [ ] reviewer tidak finalisasi own entry (wajib diuji di backend saat fitur laporan dibuat; `docs/PERMISSIONS.md` catatan ¹)
- [ ] snapshot dibuat
- [ ] final export menggunakan snapshot
- [ ] Addendum setelah final tidak mengubah snapshot lama

## J. Reopen

- [ ] hanya role berwenang
- [ ] reason wajib
- [ ] audit log dibuat

## K. AI Extraction

- [x] D-059: Analisa & Harga tersedia di Lihat RAB, bukan tab detail proyek; pencarian/detail/subanalisa/tautan kembali tetap pada paket RAB yang dipilih, dan URL lama diarahkan dengan konteks yang sama
- [x] D-058: MC0/Addendum tanpa analisa mewarisi analisa versi approved sebelumnya melalui salinan dependency terpakai dan keputusan pemetaan yang terlacak
- [x] analisa baru dipakai bila tersedia; item baru tanpa pasangan/selisih harga masuk review, dan harga paket sumber tidak berubah
- [x] D-056: Penawaran/Kontrak, MC0, dan tiap Addendum memiliki paket rekap/analisa/bahan/upah/alat/harga sendiri
- [x] D-063: overhead tercantum tetapi harga merujuk biaya langsung D → WARNING `OVERHEAD_UNUSED` (persentase, harga dipakai, sel sumber); harga sumber tetap; analisa normal tanpa warning
- [x] D-063: setiap item (harga + PPN, jumlah) dan total direkonsiliasi dengan nilai cached workbook (D-054); selisih nominal → WARNING tanpa mengganti angka; sisa float sel total dibedakan (`FLOAT_RESIDUE`)
- [x] daftar/detail/pencarian analisa dan harga dibatasi versi RAB; backend menolak relasi lintas paket
- [x] kandidat analisa RAB lama yang dikonfirmasi disalin bersama dependency terpakai ke paket tujuan; perubahan paket tujuan tidak mengubah asal
- [x] backfill/seed mempertahankan histori approved dan membuktikan isolasi paket, bukan hanya total yang sama
- [x] nama rekap berbeda dari analisa: formula menghubungkan keduanya, nama item RAB mengikuti rekap dan nama analisa asli tetap tersimpan
- [x] referensi formula berantai dan bukti sumber dapat ditinjau; formula ambigu/hilang atau file eksternal tidak tersedia masuk review tanpa tebakan nama
- [x] pipeline memakai instruksi impor tetap dari RAB_IMPORT_GUIDE, versi instruksi tercatat, serta hasil AI tetap divalidasi backend
- [x] hanya analisa yang dirujuk item RAB beserta komponen/harga yang diperlukan diimpor; referensi lain di workbook tidak menjadi record domain
- [x] analisa yang dipakai beberapa item tidak diduplikasi; referensi hilang/ambigu ditampilkan untuk review
- [x] volume 0 tidak otomatis menyebabkan analisa item terpilih dibuang; koefisien 0 pada analisa terpilih tetap terlacak
- [x] harga komponen × koefisien membentuk harga analisa, lalu × volume membentuk nilai item/rekap, dengan decimal dan aturan pajak/rounding yang sudah disetujui
- [x] selisih harga hasil analisa dengan RAB sumber ditampilkan pada review; perubahan sumber tidak menimpa RAB approved atau histori
- [ ] satu file multi-sheet atau beberapa file Struktur/Arsitektur/MEP menghasilkan satu draft versi RAB dengan hierarki disiplin tetap ada
- [x] paket lengkap menyimpan file RAB, rekap, analisa, upah, bahan, dan alat beserta locator sumber setiap baris
- [x] analisa gabungan lintas disiplin dan blok RAB/analisa pada file/sheet yang sama dapat dipetakan tanpa mewajibkan pemisahan file
- [x] analisa dari sumber gabungan maupun terpisah Struktur/Arsitektur/MEP muncul di satu daftar untuk RAB yang sama, tidak bercampur versi lain (scope dikoreksi D-056; test lama berscope proyek belum cukup)
- [x] beberapa item RAB dapat merujuk satu analisa tervalidasi tanpa menggandakan komponennya; konflik referensi tetap direview
- [ ] rekap/subtotal/total sumber tidak dihitung dua kali sebagai ITEM
- [x] kode item/analisa yang sama lintas sumber tidak auto-merge; konflik ditampilkan untuk review
- [x] nilai konsolidasi direkonsiliasi dengan rincian/rekap sumber memakai decimal
- [x] Kontrak, MC0, dan Addendum dari paket berbeda tidak saling menimpa
- [ ] status draft analisa/harga dibedakan dari data resmi; upload tidak mengubah RAB approved
- [x] file asli disimpan
- [x] extraction memiliki source locator
- [x] invalid schema retry maksimal sesuai kebijakan
- [x] failed extraction tidak menjadi official RAB
- [x] review dapat edit hasil AI
- [x] UNCERTAIN item match wajib human decision
- [x] approval membuat official RAB transactionally
- [x] audit dibuat
- [x] status impor UPLOADED → PROCESSING → NEEDS_REVIEW → APPROVED/REJECTED, FAILED untuk kegagalan teknis; retry membuat run baru tanpa menimpa run lama (D-048)
- [x] permission dokumen/impor/AHSP ditegakkan backend per proyek (D-049)
- [x] approve impor menghasilkan daftar harga, analisa/komponen resmi, dan RAB DRAFT tertaut dalam satu transaksi; approval RAB tetap lewat M4
- [x] analisa bertingkat ikut diimpor; siklus ditolak; hanya rantai terpakai menjadi record domain
- [x] harga analisa = Σ(harga × koefisien) + overhead sumber, dibulatkan sesuai sumber; direkonsiliasi dengan workbook (D-051)
- [x] selisih harga analisa vs RAB memblokir approve sampai reviewer memilih harga analisa atau override beralasan; kedua nilai, harga efektif, alasan, actor, waktu tersimpan
- [x] harga langsung diperbolehkan dengan warning; baris judul tanpa kode tidak dianggap item harga langsung
- [x] AI hanya untuk baris putus/ambigu; fallback model dipakai saat model utama gagal teknis; model, attempt, versi instruksi tercatat; kedua model gagal → review manual
- [x] impor MC-0/Addendum: work item dicocokkan lewat keputusan reviewer, kandidat tidak diterapkan otomatis (D-053)
- [x] RAB approved tetap menunjuk versi analisa/harga lama setelah impor berikutnya
- [x] seed `db:seed:sample-ahsp` (`SDN2-SERANGAN-2026-PAKET`) membuat paket Kontrak, MC-0 (warisan Kontrak), dan Addendum (warisan MC-0) yang terisolasi; rekonsiliasi Kontrak & MC-0 sama dengan workbook; aman diulang

## L. Security

- [ ] auth cookie HTTP-only
- [ ] backend authorization
- [ ] secrets tidak di-client
- [ ] 9router tidak dipanggil dari browser
- [ ] upload MIME/size validation

### D-060 Rincian paket RAB

- [x] Lihat RAB memiliki Rekap RAB / Analisa / Bahan / Alat / Upah sesuai izin.
- [x] Harga difilter berdasarkan kategori pemakaian, bukan nama sheet; pencarian tetap pada versi terpilih.
- [x] Detail analisa menampilkan koefisien, kelompok kosong, subtotal A/B/C, D/E/F dan pembulatan sumber.
- [x] Desktop dan mobile tidak mengalami overflow halaman (tabel rincian dapat digeser).

Verifikasi D-060: lint, typecheck, build; 43 test calc dan 129 test API lulus.
Browser memakai API fixture terisolasi pada desktop 1440 dan mobile 390:
lima tab, rincian, navigasi versi, redirect lama, izin dan overflow lulus.

### D-061 UI dan asal nilai

- [x] Nilai RAB membuka nilai lengkap, rumus, operand dan baris/analisa sumber.
- [x] Komponen analisa dapat ditelusuri ke harga dasar atau subanalisa dan dokumen.
- [x] Nilai manual/override serta sumber yang tidak tercatat dijelaskan tanpa tebakan.
- [x] Pratinjau Excel dibatasi, menampilkan nilai cached dan referensi tanpa eksekusi.
- [x] Permission dokumen dan isolasi proyek diperiksa backend (403/404).
- [x] Dialog dapat ditutup dengan Escape dan fokus kembali; tujuan tautan disorot.
- [x] Halaman utama/admin/proyek/RAB dan pratinjau nyaman pada desktop/mobile.

Verifikasi D-061: lint/typecheck/build lulus; 43 test calc dan 131 test API
lulus (termasuk preview batas sel, permission dan isolasi dokumen). Browser
dengan API fixture terisolasi pada 1440/390 memeriksa halaman utama, profil,
admin user/role/akses, wizard proyek, informasi/kalender/tim, dokumen/impor,
review impor dan lima tab RAB; perjalanan RAB → analisa → sumber Excel,
referensi sel, dialog Escape/fokus kembali, serta tautan yang membuka kelompok
RAB diciutkan lulus tanpa error browser atau overflow halaman. Hasil lokal:
`/tmp/report-rab-modern-preview/results.json`.

### D-062 Satu tingkat tab RAB

- [x] Rekap, daftar/detail analisa, bahan, alat dan upah hanya menampilkan tab paket; tab proyek tidak diulang.
- [x] Tautan ke proyek, daftar versi dan daftar analisa mempertahankan tujuan dan izin.
- [x] Tampilan desktop/mobile serta perjalanan sumber nilai tetap berfungsi.
