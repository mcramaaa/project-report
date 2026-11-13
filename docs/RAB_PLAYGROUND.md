# RAB Playground — impor RAB dibantu AI (rancangan D-093)

Status: **usulan, menunggu persetujuan** (2026-11-11). Belum ada kode.

## 1. Masalah

Setiap RAB dari dinas/penyedia berbeda bentuk: susunan kolom, letak judul, formulir analisa (kantor, Bina Marga,
Cipta Karya, …), cara harga dirangkai (rujukan, VLOOKUP, IF, pembulatan). D-090–D-092 menangani bentuk yang sudah
dikenal lewat kode; bentuk baru masih menuntut kode baru. Playground memindahkan "memahami bentuk workbook" ke AI
dan reviewer, tanpa melepas pembuktian angka.

## 2. Prinsip

1. **AI menafsirkan, sistem membuktikan.** AI hanya memberi *klaim* tentang struktur: sheet mana RAB, kolom apa
   berperan apa, sel mana total analisa (F), biaya langsung (D), overhead (E), komponen, harga dasar. Setiap klaim
   menyebut alamat sel.
2. **Tidak ada angka dari AI.** Semua angka (volume, koefisien, harga, total) dibaca sistem dari sel Excel. Nama item
   dan harga juga berupa alamat sel yang ditunjuk AI, bukan teks yang ditulis AI. Klaim yang menyebut sel kosong
   atau sel tanpa nilai ditolak.
3. **Klaim yang tidak terbukti tidak dipakai.** Pembuktian (bagian 5) bersifat mekanis: rumus benar-benar merujuk sel
   yang diklaim, dan perhitungan ulang desimal sama dengan nilai tersimpan Excel (toleransi D-054).
4. **AI tidak menulis ke RAB resmi** (AGENTS.md). Hasil playground adalah *profil pemetaan*; impor tetap berjalan
   lewat run, draft, review, dan approval seperti sekarang (D-048–D-053).
5. **Mesin dulu, AI belakangan.** Penelusur rumus yang ada (D-051, D-090–D-092) dijalankan lebih dulu; AI hanya
   diminta untuk bagian yang gagal atau formulir yang belum dikenal. Pada RAB Paving Tuban mesin sudah
   menyelesaikan 57 dari 59 item tanpa AI.

## 3. Alur

```text
Upload dokumen
 → Playground: mesin membaca dengan profil yang cocok (bawaan atau tersimpan)
 → Pratinjau: jumlah item, item tertaut analisa / langsung / gagal, total vs Rekap, daftar masalah per sel
 → Reviewer bertanya/memerintah lewat chat ("analisa paving ada di sheet Analisa CK", "harga pakai kolom L")
     atau mengedit profil langsung
 → AI mengusulkan perubahan profil (klaim terstruktur)
 → Sistem membuktikan klaim → pratinjau diperbarui; klaim gagal dikembalikan dengan alasannya
 → Reviewer menyimpan profil (eksplisit)
 → Buat impor dengan profil itu → draft → review → approval (tidak berubah)
```

## 4. Profil pemetaan

Data deklaratif berversi (zod di `packages/shared`), disimpan per proyek dan dapat dipakai ulang untuk MC berikutnya.

- **Sheet**: peran tiap sheet (RAB, ANALISA, DAFTAR_HARGA, ABAIKAN).
- **Sheet RAB**: pemetaan kolom (`rabColumnMapSchema` D-090), baris header, aturan hierarki (penanda divisi, pola kode
  grup/sub-judul), rumus harga sumber (D-092).
- **Formulir analisa**: sinonim judul kolom (KOMPONEN/URAIAN, KUANTITAS/KOEFISIEN, …), arah judul (dua baris),
  pergeseran kolom jumlah, label baris D/E/F/"Dibulatkan", letak judul analisa (ITEM PEMBAYARAN/JENIS PEKERJAAN atau
  satu sel), bentuk overhead (persen/pecahan).
- **Pengecualian per sel** (bila pola tidak cukup): "sel X adalah F analisa yang blok labelnya di baris Y",
  "harga komponen baris Z = item daftar harga bernama sel W".

Bentuk yang sekarang tertanam di kode (kantor, Bina Marga, Cipta Karya) menjadi **profil bawaan**; perilakunya harus
sama persis (test yang ada + pembandingan file Paving/SDN 2 Serangan menjadi pengaman).

## 5. Pembuktian klaim

| Klaim | Bukti mekanis |
|---|---|
| Sel F = total analisa | rumus F = D + E (atau ROUND/ROUNDUP/ROUNDDOWN atasnya); E = D × persen; D = Σ subtotal |
| Komponen | sel jumlah = harga × koefisien dari kolom yang diklaim, baris yang sama |
| Harga komponen | rantai rujukan/VLOOKUP/IF yang ada (D-091) sampai sel bernilai; nama = sel teks di baris itu |
| Kolom RAB | baris item berkode punya nilai di kolom yang diklaim; total kuantitas × harga dibandingkan Rekap |
| Rumus harga sumber | D-092 (desimal, mode pembulatan Excel) |

Setiap hasil membawa bukti (alamat sel, teks rumus, nilai tersimpan, selisih) yang tampil di pratinjau dan review.

## 6. Data yang dikirim ke AI

- Daftar sheet + ukurannya; teks 40 baris pertama sheet yang relevan (judul kolom).
- Untuk masalah tertentu: "lingkungan rumus" sel yang macet — sel di blok terkait dengan teks rumus dan nilai
  tersimpan, dibatasi anggaran karakter per permintaan.
- Ringkasan masalah dari mesin dan perintah reviewer.
- **Tidak** dikirim: seluruh workbook, data pengguna lain, kunci/rahasia.

**Perlu disadari:** 9router meneruskan permintaan ke penyedia model eksternal (Codex/Claude, combo
`ebp-ai-project-report`). Isi workbook yang dikirim (judul, rumus, angka di sekitar masalah) keluar dari server.

## 7. Bentuk jawaban AI

JSON tervalidasi zod (seperti `aiCandidateResponseSchema` sekarang): daftar perubahan profil dan/atau klaim per sel,
masing-masing dengan alasan singkat. Jawaban yang tidak lolos skema = gagal teknis (dicatat, dicoba model cadangan
lewat combo 9router).

## 8. Pencatatan dan izin

- Sesi playground (tabel baru) per proyek/dokumen; setiap panggilan AI dicatat seperti `ai_runs` (sekarang `ai_runs`
  wajib terkait impor → perlu kolom sesi atau tabel sendiri).
- Profil tersimpan dengan pembuat, waktu, asal (BAWAAN/MANUAL/AI), dan snapshot profil ikut tercatat di setiap run
  impor (audit).
- Izin: `rabImport.review` untuk playground dan menyimpan profil; approval tetap `rabImport.approve`.

## 9. Tahapan

1. **Profil + pembukti tanpa AI**: skema profil, mesin membaca dari profil, profil bawaan menggantikan pola di kode;
   hasil impor yang ada tidak boleh berubah.
2. **UI playground**: pratinjau, daftar masalah per sel, editor profil manual, simpan profil, buat impor dari profil.
3. **Asisten AI**: chat → klaim → pembuktian → pratinjau; anggaran token per sesi.
4. Penggunaan ulang: usulan profil otomatis dari profil proyek lain yang cocok.

## 10. Pertanyaan terbuka

1. Persetujuan mengirim potongan isi workbook ke penyedia model eksternal lewat 9router (bagian 6).
2. Cakupan profil: per proyek saja, atau bisa dibagikan antar proyek dalam satu instansi?
3. Batas biaya: anggaran token per sesi playground.
