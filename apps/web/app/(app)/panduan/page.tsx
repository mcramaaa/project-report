import type { ReactNode } from 'react';
import { PageTitle, Section } from '@/components/ui';
import { requireMe } from '@/lib/server-api';

/** In-app user guide: the work in the order teams do it, and the rules that tie the steps together. */
const CHAPTERS = [
  ['alur', 'Alur kerja'],
  ['peran', 'Peran dan izin'],
  ['akun', 'Akun dan akses'],
  ['proyek', 'Proyek dan tab Informasi'],
  ['rab', 'Tab RAB dan baseline'],
  ['jadwal', 'Tab Jadwal'],
  ['progres', 'Progres mingguan dan alokasi harian'],
  ['harian', 'Laporan harian'],
  ['mingguan', 'Laporan mingguan'],
  ['template', 'Template, cetak, dan PDF'],
  ['pekerja', 'Pekerja'],
  ['aturan', 'Aturan yang saling terkait'],
  ['faq', 'Pertanyaan umum'],
] as const;

const FLOW: [string, string, string][] = [
  ['Buat proyek', 'Data kontrak dan SPMK', 'Minggu M.n (7 hari) dan periode B.n (4 minggu)'],
  ['RAB Kontrak', 'Proyek', 'Item pekerjaan, volume, harga, bobot'],
  ['Aktifkan baseline', 'RAB approved', 'Versi RAB yang berlaku tiap minggu'],
  ['Jadwal', 'RAB approved', 'Rencana % per kelompok per minggu (Kurva S rencana)'],
  [
    'Progres mingguan',
    'Baseline minggu itu, minggu sudah dimulai',
    'Realisasi volume dan Kurva S realisasi',
  ],
  ['Alokasi harian', 'Progres minggu itu', 'Volume per hari'],
  ['Laporan harian', 'Alokasi hari itu dan AHSP', 'Pekerjaan, tenaga kerja, bahan, alat, cuaca'],
  [
    'Laporan mingguan',
    'Progres, jadwal, laporan harian',
    'Rekap RM, detail M, Kurva S; final membekukan minggu',
  ],
  ['Laporan bulanan', 'Laporan 4 minggu periode itu', 'Rangkuman B.n, ekspor PDF/Excel'],
];

const ROLES: [string, string][] = [
  [
    'FILLER (penginput)',
    'Isi progres mingguan, alokasi harian, dan laporan harian; ajukan laporan mingguan.',
  ],
  [
    'REVIEWER (pemeriksa)',
    'Periksa laporan mingguan, kecuali minggu yang progresnya ia isi sendiri.',
  ],
  [
    'MANAGER',
    'Semua di atas, ditambah ubah data proyek, RAB, baseline, jadwal, finalkan dan buka kembali laporan.',
  ],
  ['ADMIN (proyek)', 'Unggah dokumen, review impor RAB, edit draft RAB.'],
  ['RAB_EDITOR', 'Kelola draft dan koreksi RAB serta analisa, approve RAB, baseline, jadwal.'],
];

const RULES: [string, string][] = [
  [
    'Laporan mingguan minggu X final',
    'Progres, alokasi harian, dan laporan harian minggu X dan sebelumnya terkunci. Perubahan baseline yang mengenai minggu itu ditolak.',
  ],
  [
    'Laporan mingguan dibuka kembali',
    'Kunci lepas. Snapshot lama tetap tersimpan; laporan diperiksa dan difinalkan lagi.',
  ],
  [
    'Baseline baru diaktifkan',
    'Minggu sesudahnya diukur dengan volume dan bobot versi baru. Progres lama tidak berubah.',
  ],
  [
    'Volume versi baru lebih kecil dari realisasi',
    'Muncul peringatan saat aktivasi; realisasi tidak diubah.',
  ],
  [
    'Jadwal atau RAB direvisi',
    'Laporan final tidak berubah (snapshot). Laporan yang belum final ikut angka baru.',
  ],
  ['Laporan harian final', 'Volume pekerjaan dan hitungan bahan/alat dibekukan.'],
  [
    'Sudah ada progres atau laporan',
    'Tanggal mulai proyek terkunci; masa pelaksanaan masih bisa ditambah.',
  ],
  ['Proyek ditutup', 'Semua data hanya-baca sampai proyek dibuka kembali.'],
  ['Setiap perubahan penting', 'Tercatat di audit: siapa, kapan, nilai lama dan baru, alasan.'],
];

const FAQ: [string, ReactNode][] = [
  [
    'Progres tidak bisa diisi',
    'Minggu belum dimulai, belum ada baseline (aktifkan di tab RAB), minggu terkunci laporan mingguan final, atau proyek ditutup.',
  ],
  ['Tombol "Tandai diperiksa" mati', 'Anda ikut mengisi progres minggu itu. Minta pemeriksa lain.'],
  ['Rencana dan deviasi kosong', 'Jadwal versi baseline belum approved.'],
  [
    'Kumulatif melebihi volume',
    'Baseline minggu itu memakai versi dengan volume lebih kecil. Periksa kartu Baseline berlaku di tab RAB, atau koreksi progres.',
  ],
  [
    'Angka berbeda dengan Excel kantor',
    'Rencana dihitung dari jadwal yang disesuaikan ke bobot versi RAB. Realisasi = volume ÷ volume item × bobot item.',
  ],
  [
    'PDF berbeda dengan pratinjau',
    'Di dialog cetak pilih "Simpan sebagai PDF", ukuran kertas sesuai template, dan nonaktifkan header/footer browser.',
  ],
  [
    'Ekspor Excel dan laporan bulanan',
    'Sedang disiapkan: ekspor Excel memakai template yang sama, lalu laporan bulanan per periode B.n.',
  ],
];

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="guide-steps">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function Chapter({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Section id={id} title={title}>
      <div className="guide-body">{children}</div>
    </Section>
  );
}

const b = (text: string) => <b>{text}</b>;

export default async function GuidePage() {
  await requireMe();
  return (
    <>
      <PageTitle subtitle="Cara memakai aplikasi, mengikuti urutan kerja proyek dari awal sampai laporan mingguan final.">
        Panduan
      </PageTitle>
      <div className="guide-layout">
        <nav className="guide-toc" aria-label="Daftar isi panduan">
          <p>Daftar isi</p>
          <ol>
            {CHAPTERS.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="stack min-w-0">
          <Chapter id="alur" title="Alur kerja">
            <p>Setiap langkah memakai hasil langkah sebelumnya. Kerjakan berurutan.</p>
            <ol className="guide-flow">
              {FLOW.map(([step, needs, gives]) => (
                <li key={step}>
                  <b>{step}</b>
                  <span>Butuh: {needs}</span>
                  <span>Menghasilkan: {gives}</span>
                </li>
              ))}
            </ol>
          </Chapter>

          <Chapter id="peran" title="Peran dan izin">
            <p>
              Izin diatur per proyek lewat role. Role bawaan bisa diubah super admin di Pengguna →
              Role & permission.
            </p>
            <dl className="guide-pairs">
              {ROLES.map(([role, task]) => (
                <div key={role}>
                  <dt>{role}</dt>
                  <dd>{task}</dd>
                </div>
              ))}
            </dl>
            <p>
              Super admin punya semua izin, tetapi aturan kerja tetap berlaku untuknya. Contohnya,
              ia tidak boleh memeriksa minggu yang progresnya ia isi sendiri. Izin global{' '}
              {b('Kelola pekerja')} diberikan lewat role global.
            </p>
          </Chapter>

          <Chapter id="akun" title="Akun dan akses">
            <Steps
              items={[
                <>
                  Masuk dengan email dan password. {b('Profil & keamanan')} dipakai untuk ganti
                  password; sesi lain otomatis keluar.
                </>,
                <>{b('Pengguna → Pengguna')}: tambah user, ubah, atau nonaktifkan.</>,
                <>{b('Role & permission')}: atur izin role proyek, atau buat role global.</>,
                <>
                  {b('Akses proyek')}: tambahkan user ke proyek dengan role tertentu, ubah role,
                  atau cabut akses.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="proyek" title="Proyek dan tab Informasi">
            <Steps
              items={[
                <>
                  {b('Proyek saya → Proyek baru')}: isi Identitas, Kontrak, dan SPMK (tanggal mulai
                  dan masa pelaksanaan). Pembuat otomatis menjadi MANAGER.
                </>,
                <>
                  Minggu M.n dan periode B.n terbentuk otomatis dan bisa dilihat di{' '}
                  {b('Minggu & periode laporan')}.
                </>,
                <>
                  {b('Ubah identitas')} mengubah teks di kartu Data proyek menjadi isian; simpan
                  dengan alasan (opsional). {b('Ubah jadwal')} mengubah tanggal mulai atau masa
                  pelaksanaan dengan pratinjau minggu; alasan wajib.
                </>,
                <>
                  Tanggal mulai terkunci setelah ada progres atau laporan. Masa pelaksanaan tetap
                  bisa ditambah, misalnya untuk adendum waktu.
                </>,
                <>
                  {b('Tutup proyek')} membuat semua data hanya-baca; {b('Buka kembali proyek')}{' '}
                  mengembalikannya.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="rab" title="Tab RAB dan baseline">
            <h3>Membuat versi</h3>
            <Steps
              items={[
                <>
                  {b('Buat RAB Kontrak')} atau {b('Buat MC-n')} di kartu Versi RAB. Versi MC
                  menyalin versi approved terakhir; kode pekerjaan tetap sama.
                </>,
                <>
                  Atau {b('Impor dari Excel')}: unggah file, tentukan peran dokumen dan sheet RAB,
                  mulai impor, tinjau pasangan item, harga, dan analisa, lalu approve impor.
                  Hasilnya draft RAB lengkap dengan analisa.
                </>,
                <>
                  Buka versi untuk melihat atau mengedit: tab Rekap RAB, Analisa, Bahan, Alat, Upah.
                  Nilai bergaris putus-putus bisa diklik untuk melihat rumus dan sumbernya.
                </>,
                <>
                  {b('Approve')} mengunci versi. ERROR menahan approve; WARNING boleh diterima
                  dengan konfirmasi.
                </>,
                <>
                  {b('Buka untuk koreksi')} mengoreksi versi approved dengan alasan, lalu{' '}
                  {b('Approve ulang')}. Snapshot lama tetap ada di Riwayat & snapshot.
                </>,
              ]}
            />
            <h3>Baseline berlaku</h3>
            <p>
              Pita minggu menunjukkan versi yang berlaku tiap minggu. Baseline pertama selalu
              Kontrak sejak tanggal mulai. Versi berikutnya diaktifkan dengan{' '}
              {b('Minggu berikutnya')} (minggu sesudah tanggal dokumen) atau {b('Tanggal pasti')}.
              Satu minggu memakai versi yang berlaku di akhir minggu itu.
              {b(' Cabut')} hanya untuk aktivasi terakhir, dengan alasan.
            </p>
          </Chapter>

          <Chapter id="jadwal" title="Tab Jadwal">
            <Steps
              items={[
                <>
                  Buat satu jadwal per versi RAB approved. Isi % bobot per kelompok per minggu di
                  grid, atau impor sheet Master Curva S.
                </>,
                <>
                  Jumlah tiap kelompok harus sama dengan bobotnya, lalu {b('Approve')}. Revisi lewat{' '}
                  {b('Buka kembali')} dengan alasan.
                </>,
                <>
                  {b('Kurva S')}: rencana dari jadwal versi baseline, realisasi dari progres.
                  Arahkan kursor ke kurva untuk melihat angka per minggu.
                </>,
                <>
                  {b('Analisis keterlambatan')}: kelompok yang terlambat dan target per minggu agar
                  selesai tepat waktu; rincian item bisa dibuka.
                </>,
                <>
                  {b('Simulasi jadwal')}: coba geser atau perpanjang pekerjaan tanpa mengubah jadwal
                  resmi. Skenario bisa dijadikan jadwal resmi atau dihapus.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="progres" title="Progres mingguan dan alokasi harian">
            <Steps
              items={[
                <>
                  Tab Progres → pilih minggu. Di atas tiap minggu ada tab {b('Isi progres')},{' '}
                  {b('Laporan harian')}, {b('Laporan mingguan')}, dan {b('Laporan bulanan')}, serta
                  tombol pindah minggu.
                </>,
                <>
                  Isi {b('Volume minggu ini')} atau {b('% kumulatif')}. Kumulatif tidak boleh
                  melebihi volume baseline minggu itu.
                </>,
                <>
                  {b('Simpan progres')} di bilah bawah (muncul kuning bila ada isian belum
                  disimpan). Minggu yang belum dimulai belum bisa diisi.
                </>,
                <>
                  Tab {b('Laporan harian')}: pilih hari untuk membuka laporannya. Di bawahnya,{' '}
                  {b('Alokasi volume per hari')} membagi volume minggu ke 7 hari dengan faktor hari
                  kantor; pembagian per item bisa diubah manual asalkan totalnya tetap.
                </>,
                <>
                  Tab {b('Laporan bulanan')} menampilkan B.n (4 minggu) yang dirangkum otomatis dari
                  minggu-minggunya; tidak perlu diisi atau diajukan, cukup diekspor.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="harian" title="Laporan harian">
            <Steps
              items={[
                <>Dari halaman minggu, pilih hari di strip H1–H7.</>,
                <>{b('Pekerjaan hari ini')} diambil dari alokasi harian.</>,
                <>
                  Tenaga kerja, bahan, dan alat dihitung dari AHSP (volume hari itu × koefisien).
                  Isi kolom {b('Aktual')}; {b('pakai hitungan')} menyalin angka hitungan (tenaga
                  kerja dibulatkan ke orang utuh). Nama dan satuan baris boleh diubah, dan baris
                  kecil bisa disembunyikan.
                </>,
                <>
                  Isi cuaca beserta jamnya, lalu {b('Simpan laporan')} dan {b('Finalkan')}. Laporan
                  final terkunci; tombol {b('Revisi')} (MANAGER, alasan wajib) membukanya untuk
                  diubah, lalu finalkan lagi. Bila minggunya terkunci laporan mingguan final, buka
                  kembali laporan mingguan dulu.
                </>,
                <>
                  Laporan hari baru otomatis diisi jumlah orang dan alat dari laporan sebelumnya.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="mingguan" title="Laporan mingguan">
            <Steps
              items={[
                <>{b('Ajukan laporan')} oleh penginput, setelah minggu berakhir.</>,
                <>
                  {b('Tandai diperiksa')} oleh REVIEWER atau MANAGER yang tidak ikut mengisi progres
                  minggu itu; catatan opsional.
                </>,
                <>
                  {b('Finalkan')} oleh MANAGER. Isi laporan dibekukan sebagai snapshot dan minggu
                  itu terkunci.
                </>,
                <>
                  {b('Buka kembali')} oleh MANAGER dengan alasan, mulai dari minggu final paling
                  akhir.
                </>,
              ]}
            />
            <p>
              Isinya: ringkasan realisasi, rencana, dan deviasi; waktu total, terpakai, dan sisa;
              rekap per kelompok (lembar RM); Kurva S sampai minggu itu; rangkuman laporan harian;
              detail item (lembar M).
            </p>
          </Chapter>

          <Chapter id="template" title="Template, cetak, dan PDF">
            <Steps
              items={[
                <>
                  Tab Informasi → kartu {b('Template laporan')} → {b('Atur template')}. Template
                  berlaku per proyek, terpisah untuk laporan harian, mingguan, dan bulanan.
                </>,
                <>
                  Unggah logo {b('Pemberi tugas / dinas')}, {b('Konsultan pengawas')}, dan{' '}
                  {b('Kontraktor')}. Logo dipakai di kop semua jenis laporan.
                </>,
                <>
                  Atur kertas (A4/F4/Legal, tegak/mendatar, margin, ukuran huruf), baris kop, judul,
                  isian identitas, bagian laporan dan kolomnya (tampil, judul, urutan), serta kolom
                  tanda tangan. Pratinjau di kanan langsung berubah; {b('Simpan template')} untuk
                  menyimpan.
                </>,
                <>
                  {b('Impor')} menyalin template (dan logo bila dicentang) dari proyek lain yang
                  bisa Anda buka.
                </>,
                <>
                  Laporan harian bawaan memakai format kolom berdampingan seperti laporan harian
                  kantor (bisa diganti ke layout bertumpuk di template; nama keahlian Staff Kantor
                  diatur di sana). Di laporan harian klik {b('Ekspor Excel')} untuk file Excel
                  dengan layout yang sama. Agar laporan mingguan sama persis dengan Excel kantor,
                  unggah workbook mingguan kantor di Template laporan → Laporan mingguan → File
                  Excel kantor; Ekspor Excel lalu mengisi progres ke file itu (dan PDF dicetak dari
                  file itu bila LibreOffice terpasang di server). Tanpa file itu, laporan mingguan
                  memakai format kantor bawaan: sampul, rekap, progres, dan time schedule,
                  masing-masing satu halaman, dan juga punya tombol {b('Ekspor Excel')} dengan sheet
                  yang sama. Di laporan harian atau mingguan, klik {b('Ekspor PDF')}. Halaman cetak
                  terbuka; tekan {b('Cetak / Simpan PDF')} lalu pilih &quot;Simpan sebagai
                  PDF&quot;. Laporan final memakai data snapshot; tampilannya mengikuti template
                  saat dicetak.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="pekerja" title="Pekerja">
            <Steps
              items={[
                <>Menu {b('Pekerja')} di sidebar berisi daftar pekerja untuk semua proyek.</>,
                <>
                  {b('Tambah pekerja')} atau {b('Ubah')}: nama, posisi (ada saran), NIK 16 digit,
                  dan foto KTP (opsional).
                </>,
                <>
                  {b('Impor Excel')}: unduh template, isi, unggah. Satu baris salah membatalkan
                  seluruh impor, dan semua kesalahan ditampilkan.
                </>,
                <>
                  NIK lengkap dan foto KTP hanya untuk pemegang Kelola pekerja; user lain melihat
                  NIK tersamar. Pekerja dinonaktifkan, tidak dihapus.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="aturan" title="Aturan yang saling terkait">
            <dl className="guide-pairs">
              {RULES.map(([when, then]) => (
                <div key={when}>
                  <dt>{when}</dt>
                  <dd>{then}</dd>
                </div>
              ))}
            </dl>
          </Chapter>

          <Chapter id="faq" title="Pertanyaan umum">
            <dl className="guide-pairs">
              {FAQ.map(([q, a]) => (
                <div key={q}>
                  <dt>{q}</dt>
                  <dd>{a}</dd>
                </div>
              ))}
            </dl>
          </Chapter>
        </div>
      </div>
    </>
  );
}
