import type { ReactNode } from 'react';
import { PageTitle, Section } from '@/components/ui';
import { requireMe } from '@/lib/server-api';

/** In-app user guide: the work in the order teams do it, and the rules that tie the steps together. */
const CHAPTERS = [
  ['alur', 'Alur kerja'],
  ['istilah', 'Istilah'],
  ['peran', 'Peran dan izin'],
  ['akun', 'Masuk, profil, dan password'],
  ['proyek-baru', 'Daftar proyek dan proyek baru'],
  ['proyek', 'Tab Informasi'],
  ['rab', 'Tab RAB: versi'],
  ['impor', 'Impor RAB dari Excel'],
  ['rab-isi', 'Isi versi RAB'],
  ['rab-koreksi', 'Approve, koreksi, dan riwayat'],
  ['baseline', 'Baseline berlaku'],
  ['jadwal', 'Tab Jadwal dan Kurva S'],
  ['simulasi', 'Keterlambatan dan simulasi'],
  ['progres', 'Progres mingguan'],
  ['alokasi', 'Alokasi harian'],
  ['harian', 'Laporan harian'],
  ['mingguan', 'Laporan mingguan'],
  ['bulanan', 'Laporan bulanan'],
  ['template', 'Template laporan'],
  ['excel-kantor', 'File Excel kantor'],
  ['ekspor', 'Cetak, PDF, dan Excel'],
  ['pekerja', 'Pekerja'],
  ['admin', 'Pengguna dan akses'],
  ['angka', 'Angka dan pembulatan'],
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

const TERMS: [string, string][] = [
  ['RAB', 'Rencana Anggaran Biaya: daftar pekerjaan beserta volume, harga satuan, dan jumlah.'],
  [
    'Versi Kontrak dan MC-n',
    'Kontrak adalah RAB awal. MC-n (Mutual Check) adalah perubahan sesudahnya, misalnya MC-0 atau MC-100. Setiap versi berdiri sendiri dan punya statusnya sendiri.',
  ],
  [
    'AHSP / analisa',
    'Analisa Harga Satuan Pekerjaan: rincian tenaga, bahan, dan alat per satuan pekerjaan, lengkap dengan koefisien dan harga. Dipakai untuk harga RAB dan untuk menghitung kebutuhan harian.',
  ],
  ['Harga dasar', 'Harga satuan upah, bahan, dan alat sebelum overhead dan PPN.'],
  [
    'Bobot',
    'Porsi suatu item atau kelompok terhadap total RAB, dalam persen. Seluruh bobot berjumlah 100%.',
  ],
  [
    'Baseline',
    'Versi RAB approved yang menjadi acuan progres pada minggu tertentu. Volume dan bobot item diambil dari versi ini.',
  ],
  [
    'Minggu M.n',
    'Minggu proyek ke-n, 7 hari, dihitung dari tanggal mulai. Contoh: M.1 adalah 7 hari pertama.',
  ],
  ['Periode B.n', 'Periode laporan bulanan ke-n, terdiri dari 4 minggu (B.1 = M.1–M.4).'],
  ['Kurva S', 'Grafik bobot kumulatif per minggu: rencana dari jadwal, realisasi dari progres.'],
  ['Deviasi', 'Realisasi kumulatif dikurangi rencana kumulatif. Nilai negatif berarti terlambat.'],
  [
    'WI (identitas pekerjaan)',
    'Kode tetap suatu pekerjaan yang dibawa dari versi ke versi, supaya progresnya tersambung walau uraian atau urutan berubah.',
  ],
  [
    'Real cost',
    'Total RAB termasuk PPN, dibulatkan 2 desimal. Total dibulatkan = real cost tanpa desimal.',
  ],
  [
    'Snapshot',
    'Salinan beku isi RAB atau laporan pada saat approve/final. Revisi berikutnya tidak mengubah snapshot lama.',
  ],
  [
    'DRAFT, APPROVED, KOREKSI',
    'Status versi RAB: masih disusun, terkunci, atau sedang dibuka untuk koreksi.',
  ],
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
    'Semua di atas, ditambah ubah data proyek, RAB, baseline, jadwal, template, finalkan dan buka kembali laporan.',
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
    'Kunci lepas. Snapshot lama tetap tersimpan; laporan diperiksa dan difinalkan lagi. Pembukaan dimulai dari minggu final paling akhir.',
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
  [
    'Ada draft atau koreksi RAB terbuka',
    'Versi baru belum bisa dibuat. Approve atau batalkan dulu yang terbuka.',
  ],
  ['Proyek ditutup', 'Semua data hanya-baca sampai proyek dibuka kembali.'],
  [
    'Hapus data',
    'Tidak ada hapus permanen untuk progres, baseline, dan riwayat. User dan pekerja dinonaktifkan.',
  ],
  ['Setiap perubahan penting', 'Tercatat di audit: siapa, kapan, nilai lama dan baru, alasan.'],
];

const NUMBERS: [string, string][] = [
  ['Uang dan volume', 'Ditampilkan 2 desimal.'],
  ['Koefisien AHSP', 'Ditampilkan 4 desimal.'],
  ['Bobot dan persen', 'Ditampilkan 3 desimal.'],
  [
    'Perhitungan',
    'Selalu memakai presisi penuh. Pembulatan hanya untuk tampilan, kecuali real cost (2 desimal) dan total dibulatkan.',
  ],
  ['Mengetik angka', 'Tanpa pemisah ribuan. Desimal boleh dengan titik atau koma.'],
  [
    'Hari ini',
    'Mengikuti waktu WIT (UTC+9), dipakai untuk menentukan minggu berjalan dan tanggal yang sudah tiba.',
  ],
];

const FAQ: [string, ReactNode][] = [
  [
    'Progres tidak bisa diisi',
    'Minggu belum dimulai, belum ada baseline (aktifkan di tab RAB), minggu terkunci laporan mingguan final, atau proyek ditutup.',
  ],
  ['Tombol "Tandai diperiksa" mati', 'Anda ikut mengisi progres minggu itu. Minta pemeriksa lain.'],
  [
    '"Ajukan laporan" ditolak',
    'Minggu belum berakhir. Laporan mingguan diajukan setelah hari ke-7 minggu itu lewat.',
  ],
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
    '"File Excel … baru memuat sheet sampai M.x"',
    'File Excel kantor mingguan/bulanan belum punya sheet minggu atau periode itu. Tambahkan sheet M.n atau B.n di Excel, lalu unggah ulang di Template laporan. Untuk laporan harian, sheet minggu baru dibuat otomatis.',
  ],
  [
    '"File Excel tidak cocok dengan versi RAB mana pun"',
    'Uraian pekerjaan di sheet progres file kantor berbeda dengan RAB approved. Pesan menyebut baris yang tidak ditemukan; samakan uraiannya lalu unggah ulang.',
  ],
  [
    'Ekspor PDF dari file Excel kantor gagal',
    'Server butuh LibreOffice dengan python3-uno. Hubungi pengelola server, atau hapus file Excel kantor agar PDF memakai layout template.',
  ],
  [
    'PDF berbeda dengan pratinjau',
    'Di dialog cetak pilih "Simpan sebagai PDF", ukuran kertas sesuai template, dan nonaktifkan header/footer browser.',
  ],
  ['Hari di strip laporan harian tidak bisa dibuka', 'Tanggalnya belum tiba (waktu WIT).'],
  ['Menu Pengguna tidak muncul', 'Akun Anda tidak punya izin manajemen akses. Minta super admin.'],
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

function Pairs({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="guide-pairs">
      {items.map(([term, text]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{text}</dd>
        </div>
      ))}
    </dl>
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
      <PageTitle subtitle="Cara memakai aplikasi, mengikuti urutan kerja proyek dari awal sampai laporan bulanan.">
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
            <p>
              Aplikasi ini mencatat proyek konstruksi dari RAB kontrak sampai laporan harian,
              mingguan, dan bulanan. Setiap langkah memakai hasil langkah sebelumnya, jadi kerjakan
              berurutan.
            </p>
            <ol className="guide-flow">
              {FLOW.map(([step, needs, gives]) => (
                <li key={step}>
                  <b>{step}</b>
                  <span>Butuh: {needs}</span>
                  <span>Menghasilkan: {gives}</span>
                </li>
              ))}
            </ol>
            <p>
              Satu proyek punya empat tab: {b('Informasi')}, {b('RAB')}, {b('Jadwal')}, dan{' '}
              {b('Progres')}. Tab yang tidak diizinkan untuk role Anda tidak tampil.
            </p>
          </Chapter>

          <Chapter id="istilah" title="Istilah">
            <Pairs items={TERMS} />
          </Chapter>

          <Chapter id="peran" title="Peran dan izin">
            <p>
              Izin diatur per proyek lewat role. Satu user bisa punya role berbeda di proyek yang
              berbeda. Role bawaan bisa diubah super admin di Pengguna → Role & permission.
            </p>
            <Pairs items={ROLES} />
            <p>
              Super admin punya semua izin di semua proyek, tetapi aturan kerja tetap berlaku
              untuknya. Contohnya, ia tidak boleh memeriksa minggu yang progresnya ia isi sendiri.
              Izin global seperti {b('Kelola pekerja')} dan manajemen akses diberikan lewat role
              administrasi.
            </p>
            <p>
              Tombol yang tidak bisa Anda pakai tampil mati dengan penjelasan, misalnya &quot;Simpan
              dulu&quot; atau &quot;Minta MANAGER&quot;. Pemeriksaan izin juga dilakukan di server,
              jadi aksi yang tidak diizinkan tetap ditolak.
            </p>
          </Chapter>

          <Chapter id="akun" title="Masuk, profil, dan password">
            <Steps
              items={[
                <>
                  Buka aplikasi, isi {b('Email')} dan {b('Password')}, lalu klik{' '}
                  {b('Masuk ke ruang kerja')}. Ikon mata menampilkan atau menyembunyikan password.
                  Akun dibuat oleh administrator; tidak ada pendaftaran mandiri.
                </>,
                <>
                  Terlalu sering salah password membuat percobaan berikutnya ditahan sementara.
                  Tunggu sebentar lalu coba lagi.
                </>,
                <>
                  Menu {b('Profil & keamanan')} menampilkan nama, email, dan jenis akses Anda (super
                  admin, admin akses, atau anggota proyek). Perubahan nama atau email dilakukan
                  administrator.
                </>,
                <>
                  {b('Ganti password')}: isi password lama, password baru, dan ulangi password baru.
                  Setelah berhasil, semua sesi Anda berakhir dan Anda login ulang.
                </>,
                <>Tombol keluar ada di bagian bawah sidebar.</>,
              ]}
            />
          </Chapter>

          <Chapter id="proyek-baru" title="Daftar proyek dan proyek baru">
            <Steps
              items={[
                <>
                  {b('Proyek saya')} menampilkan proyek yang bisa Anda buka. Cari dengan kode atau
                  nama proyek. Proyek yang ditutup diberi tanda {b('Ditutup')}.
                </>,
                <>
                  {b('Proyek baru')} membuka isian tiga langkah. {b('Identitas')}: kode proyek,
                  kegiatan, sub kegiatan, nama pekerjaan, lokasi, tahun anggaran.
                </>,
                <>
                  {b('Kontrak')}: kontraktor, konsultan, nomor dan tanggal kontrak, nilai kontrak
                  (angka tanpa pemisah ribuan, maks. 2 desimal, contoh 1250000000.50).
                </>,
                <>
                  {b('SPMK')}: nomor dan tanggal SPMK, tanggal mulai, dan masa pelaksanaan dalam
                  hari kalender. Tanggal selesai rencana dihitung otomatis.
                </>,
                <>
                  Saat disimpan, minggu M.n dan periode B.n terbentuk otomatis, dan pembuat menjadi
                  MANAGER proyek itu. Kode proyek tidak boleh sama dengan proyek lain; bila bentrok,
                  isian kembali ke langkah yang salah.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="proyek" title="Tab Informasi">
            <Steps
              items={[
                <>
                  Kartu {b('Data proyek')} menampilkan identitas, kontrak, SPMK, dan tanggal selesai
                  rencana.
                </>,
                <>
                  {b('Ubah identitas')} mengubah teks di kartu menjadi isian; simpan dengan alasan
                  (opsional). {b('Ubah jadwal')} mengubah tanggal mulai atau masa pelaksanaan dengan
                  pratinjau minggu; alasan wajib. Minggu dan periode dibentuk ulang dari jadwal
                  baru.
                </>,
                <>
                  Tanggal mulai terkunci setelah ada progres atau laporan. Masa pelaksanaan tetap
                  bisa ditambah, misalnya untuk adendum waktu.
                </>,
                <>
                  {b('Minggu & periode laporan')} → {b('Tampilkan daftar minggu')} menampilkan
                  tanggal setiap M.n dan B.n. Periode terakhir yang kurang dari 4 minggu ditandai{' '}
                  {b('pendek')}.
                </>,
                <>
                  {b('Tim proyek')} menampilkan anggota dan role-nya. {b('Kelola akses proyek')}{' '}
                  membuka pengaturan anggota (butuh izin manajemen akses).
                </>,
                <>
                  {b('Template laporan')} → {b('Atur template')}: lihat bab Template laporan.
                </>,
                <>
                  {b('Tutup proyek')} (alasan wajib) membuat semua data hanya-baca; status laporan
                  dan snapshot tidak berubah. {b('Buka kembali proyek')} mengembalikannya.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="rab" title="Tab RAB: versi">
            <p>
              Kartu {b('Versi RAB')} berisi Kontrak dan setiap MC, dengan nomor dan tanggal dokumen,
              status, dan total real cost. Klik total untuk melihat rinciannya.
            </p>
            <Steps
              items={[
                <>
                  {b('Buat RAB Kontrak')} untuk versi pertama, lalu {b('Buat versi MC')} untuk
                  perubahan. Nomor dan tanggal dokumen opsional, tetapi tanggal dokumen dibutuhkan
                  untuk aktivasi baseline &quot;Minggu berikutnya&quot;.
                </>,
                <>
                  Versi MC menyalin versi approved terakhir; kode pekerjaan (WI) tetap sama. Nomor
                  MC boleh meloncat (MC-1 lalu MC-30), asal lebih besar dari MC terakhir.
                </>,
                <>
                  Hanya boleh ada satu draft atau koreksi terbuka. Selesaikan dulu sebelum membuat
                  versi lain.
                </>,
                <>
                  {b('Edit')} atau {b('Lihat')} membuka isi versi. {b('Bandingkan')} membuka
                  perbandingan dua versi (lihat bab Approve, koreksi, dan riwayat).
                </>,
                <>Atau buat versi dari file Excel lewat {b('Impor dari Excel')}.</>,
              ]}
            />
          </Chapter>

          <Chapter id="impor" title="Impor RAB dari Excel">
            <h3>Unggah dokumen</h3>
            <Steps
              items={[
                <>
                  Tab RAB → {b('Impor dari Excel')}. Di {b('Dokumen proyek')}, pilih file .xlsx
                  (maks. 30 MB per file) lalu {b('Upload')}. RAB, rekap, analisa, upah, bahan, dan
                  alat boleh dalam satu file atau beberapa file.
                </>,
                <>
                  Centang {b('Pakai')} untuk setiap file yang ikut impor. Tentukan{' '}
                  {b('Peran di impor')}: {b('RAB/rekap utama')} (satu file, pilih {b('Sheet RAB')}
                  -nya) atau {b('Pendukung (analisa/harga)')}.
                </>,
                <>
                  Pilih {b('Versi RAB tujuan')}: Kontrak atau MC. Untuk MC, isi nomor MC atau
                  biarkan &quot;Otomatis&quot;. Nomor MC memilih blok &quot;MC - n&quot; di sheet
                  RAB.
                </>,
                <>
                  Klik {b('Buat run impor')}. Proses berjalan di server; halaman review diperbarui
                  otomatis sampai selesai.
                </>,
              ]}
            />
            <h3>Review impor</h3>
            <Steps
              items={[
                <>
                  Bagian atas menampilkan jumlah item, analisa yang terbaca, dan{' '}
                  {b('Rekonsiliasi total')}: total hasil impor dibandingkan nilai di workbook (
                  {b('Cocok')} atau {b('Berbeda')}).
                </>,
                <>
                  Saring item dengan {b('Perlu keputusan')}, {b('Peringatan')}, atau {b('Semua')}.
                  Setiap item menampilkan uraian, volume, harga sumber, dan bagian{' '}
                  {b('Analisa & bukti')}: komponen, koefisien, dan sumber harga.
                </>,
                <>
                  Status harga: {b('Terbukti rumus')} (harga cocok dengan analisa),{' '}
                  {b('Harga langsung')} (tanpa analisa), atau {b('Belum terbukti')}.
                </>,
                <>
                  Keputusan per item: {b('Pakai harga analisa')}, {b('Harga langsung')}, atau{' '}
                  {b('Override harga sumber')} (alasan wajib). Untuk versi MC, pasangkan item dengan
                  pekerjaan lama lewat {b('Cari pekerjaan lama')}, atau tandai {b('Pekerjaan baru')}
                  .
                </>,
                <>
                  Usulan AI, kandidat ganda, pekerjaan baru, konflik harga/satuan, dan perubahan
                  analisa tidak pernah diterima otomatis; semuanya menunggu keputusan Anda.
                </>,
                <>
                  {b('Approve impor')} membuat RAB {b('DRAFT')} lengkap dengan analisa;{' '}
                  {b('Buka RAB hasil impor')} untuk memeriksanya. Draft ini belum berlaku sampai
                  di-approve di tab RAB.
                </>,
                <>
                  {b('Ulangi (run baru)')} memproses ulang dokumen yang sama. {b('Tolak')} menutup
                  run; riwayatnya tetap tersimpan. Run yang salah sheet bisa dihapus dari daftar;
                  file aslinya tetap ada.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="rab-isi" title="Isi versi RAB">
            <p>
              Versi terbuka di sub-tab {b('Rekap RAB')}, {b('Analisa')}, {b('Bahan')}, {b('Alat')},
              dan {b('Upah')}.
            </p>
            <h3>Rekap RAB</h3>
            <Steps
              items={[
                <>
                  Ringkasan di atas: total sebelum PPN, total (real cost), dan total dibulatkan.
                  Tabel di bawah berisi bagian (SECTION), sub-bagian, dan item pekerjaan.
                </>,
                <>
                  Cari dengan uraian, nomor, atau kode analisa. {b('Ciutkan semua')} /{' '}
                  {b('Buka semua')} mengatur kelompok. {b('Tampilan tabel')} → {b('Kolom')} memilih
                  kolom yang tampil.
                </>,
                <>
                  Di draft: tambah bagian atau item, {b('Ubah')} (volume, satuan, no analisa, harga
                  satuan, PPN, induk), {b('+ Sub-bagian')}, {b('Ganti WI')}, dan {b('Hapus baris')}.
                  Seret pegangan baris untuk mengubah urutan di dalam kelompok yang sama; pindah
                  kelompok lewat Ubah → Induk.
                </>,
                <>
                  Nilai bergaris putus-putus bisa diklik untuk melihat rumus dan sumbernya. Dari
                  sana {b('Sumber Excel')} menampilkan nilai tersimpan, rumus asli, referensi, dan
                  pratinjau sheet sumber.
                </>,
                <>
                  Jumlah item = volume × harga satuan × (1 + PPN ÷ 100). Bobot = jumlah item ÷ total
                  RAB eksak × 100.
                </>,
                <>
                  Kartu {b('Pemeriksaan')} menampilkan ERROR dan WARNING. Data dokumen (nomor dan
                  tanggal) diubah lewat {b('Simpan dokumen')}.
                </>,
              ]}
            />
            <h3>Analisa, Bahan, Alat, Upah</h3>
            <Steps
              items={[
                <>
                  {b('Analisa')} mendaftar AHSP versi itu: kode, nama, harga satuan, berapa item
                  memakainya, dan asal ({b('Resmi')} atau {b('Sumber baru')}).
                </>,
                <>
                  Buka analisa untuk rincian A · Tenaga, B · Bahan, C · Peralatan, biaya langsung (D
                  = A + B + C), Overhead & Profit (E), dan harga satuan (D + E). Saat draft atau
                  koreksi, koefisien, persentase overhead, pembulatan, dan konversi satuan (mis. /8,
                  ÷ 4) bisa diubah.
                </>,
                <>
                  {b('Bahan')}, {b('Alat')}, dan {b('Upah')} berisi harga dasar paket RAB itu.
                  Mengubah harga menghitung ulang analisa dan item yang memakainya. Satuan hanya
                  label.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="rab-koreksi" title="Approve, koreksi, dan riwayat">
            <Steps
              items={[
                <>
                  {b('Approve RAB')} mengunci versi dan menyimpan snapshot (baris, total, analisa,
                  harga). ERROR menahan approve; WARNING boleh diterima dengan konfirmasi.
                </>,
                <>
                  {b('Batalkan draft')} (alasan wajib) menutup draft. Draft tetap tersimpan sebagai
                  riwayat dan tidak bisa diubah lagi.
                </>,
                <>
                  {b('Buka untuk koreksi')} membuka versi approved dengan alasan. Setiap nilai yang
                  diubah diberi tanda {b('Koreksi manual')} atau {b('Dihitung ulang')}. Selesaikan
                  dengan {b('Approve ulang')}, atau {b('Batalkan koreksi')} untuk kembali ke
                  snapshot approved.
                </>,
                <>
                  {b('Riwayat & snapshot')} mencatat setiap kejadian (versi dibuat, approve, koreksi
                  baris, WI, harga dasar, komponen, overhead) dan setiap snapshot approval. Snapshot
                  menampilkan tanda {b('Checksum cocok')} bila isinya utuh.
                </>,
                <>
                  {b('Bandingkan')} (tab RAB) memilih dua versi dan menampilkan selisih volume dan
                  jumlah per pekerjaan, disaring {b('Tetap')}, {b('Berubah')}, {b('Baru')},{' '}
                  {b('Dihapus')}, atau {b('Semua')}.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="baseline" title="Baseline berlaku">
            <Steps
              items={[
                <>
                  Kartu {b('Baseline berlaku')} di tab RAB. Pita {b('Baseline per minggu')}{' '}
                  menunjukkan versi yang berlaku tiap minggu.
                </>,
                <>Baseline pertama selalu RAB Kontrak approved, berlaku sejak tanggal mulai.</>,
                <>
                  {b('Aktifkan baseline berikutnya')}: pilih versi approved, lalu cara aktivasi:{' '}
                  {b('Minggu berikutnya')} (minggu sesudah tanggal dokumen versi itu) atau{' '}
                  {b('Tanggal pasti')}. Alasan opsional.
                </>,
                <>
                  Satu minggu memakai versi yang berlaku di akhir minggu itu. Bila volume versi baru
                  lebih kecil dari realisasi, muncul peringatan; realisasi tidak diubah.
                </>,
                <>
                  {b('Cabut')} hanya untuk aktivasi terakhir, dengan alasan. Baseline sebelumnya
                  berlaku lagi dan riwayat pencabutan tetap tercatat. Minggu yang sudah final tidak
                  bisa terkena perubahan baseline.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="jadwal" title="Tab Jadwal dan Kurva S">
            <Steps
              items={[
                <>
                  {b('Jadwal per versi RAB')}: satu jadwal untuk setiap versi RAB approved. Klik{' '}
                  {b('Buat jadwal')} lalu {b('Buka')}.
                </>,
                <>
                  Isi % bobot proyek per kelompok pekerjaan per minggu di grid. Kolom kanan
                  menunjukkan rencana mingguan dan kumulatif. {b('Simpan isian')} menyimpan grid.
                </>,
                <>
                  Atau {b('Impor dari Excel')}: pilih dokumen .xlsx yang sudah diunggah di Impor
                  RAB, pilih sheet (mis. {b('Master Curva S')}), lalu {b('Impor')}.
                </>,
                <>
                  Jumlah tiap kelompok harus sama dengan bobotnya (kelompok yang belum sama
                  ditandai), lalu {b('Approve')}. Revisi lewat {b('Buka untuk revisi')} dengan
                  alasan, lalu approve lagi.
                </>,
                <>
                  {b('Kurva S')} di halaman Jadwal: rencana dari jadwal versi baseline, realisasi
                  dari progres. Arahkan kursor ke kurva untuk melihat angka per minggu. Kurva butuh
                  baseline aktif.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="simulasi" title="Keterlambatan dan simulasi">
            <h3>Analisis keterlambatan</h3>
            <Steps
              items={[
                <>
                  Kartu ringkas: sisa pekerjaan, yang harus dicapai per minggu, laju 4 minggu
                  terakhir, dan prakiraan selesai. Angka bantu, bukan jadwal resmi.
                </>,
                <>
                  Tabel kelompok: bobot, rencana, realisasi, deviasi, dan progres kelompok, dengan
                  status {b('Terlambat')}, {b('Sesuai rencana')}, {b('Lebih cepat')}, {b('Selesai')}
                  , atau {b('Belum dijadwalkan')}.
                </>,
                <>
                  Saring per bagian, status, atau kata kunci; urutkan paling terlambat, paling
                  cepat, bobot terbesar, atau urutan RAB. {b('Lihat')} membuka rincian item
                  kelompok.
                </>,
              ]}
            />
            <h3>Simulasi jadwal</h3>
            <Steps
              items={[
                <>
                  Isi {b('Nama skenario baru')}, pilih {b('Salin dari jadwal')}, lalu{' '}
                  {b('Buat skenario')}. Jadwal resmi tidak berubah.
                </>,
                <>
                  Di skenario, atur minggu {b('Mulai')} dan {b('Selesai')} tiap kelompok atau{' '}
                  {b('Geser')} kelompok. Kurva S skenario dibandingkan dengan rencana resmi.
                </>,
                <>
                  {b('Simpan skenario')}. Bila rencana skenario mencapai 100%, skenario bisa{' '}
                  {b('Jadikan jadwal resmi')}. {b('Hapus skenario')} bila tidak dipakai.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="progres" title="Progres mingguan">
            <Steps
              items={[
                <>
                  Tab Progres menampilkan semua minggu: tanggal, status progres ({b('Terisi')} /{' '}
                  {b('Belum diisi')}), baseline, dan status laporan mingguan. Minggu berjalan
                  ditandai.
                </>,
                <>
                  Buka minggu. Di atas ada tab {b('Isi progres')}, {b('Laporan harian')},{' '}
                  {b('Laporan mingguan')}, dan {b('Laporan bulanan')}, serta tombol{' '}
                  {b('Minggu pertama')}, sebelumnya, berikutnya, {b('Minggu terakhir')}, dan daftar{' '}
                  {b('Pilih minggu')} (minggu berjalan diberi &quot;minggu ini&quot;).
                </>,
                <>
                  Pilih cara isi: {b('Volume minggu ini')} atau {b('% kumulatif (seperti Excel)')}.
                  Tabel menunjukkan volume baseline, kumulatif, dan sisa per item.
                </>,
                <>
                  Kumulatif tidak boleh lebih kecil dari minggu lalu dan tidak boleh melebihi volume
                  baseline. Isian salah ditandai merah.
                </>,
                <>
                  {b('Simpan progres')} di bilah bawah (muncul bila ada isian belum disimpan).{' '}
                  {b('Batalkan isian')} membuang perubahan.
                </>,
                <>
                  Status minggu: {b('Bisa diisi')}, {b('Belum dimulai')}, {b('Terkunci')} (laporan
                  mingguan minggu ini atau sesudahnya final), atau {b('Hanya lihat')} (role Anda
                  tidak mengisi progres).
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="alokasi" title="Alokasi harian">
            <Steps
              items={[
                <>
                  Tab {b('Laporan harian')} di halaman minggu. Di bawah strip hari ada{' '}
                  {b('Alokasi volume per hari')}.
                </>,
                <>
                  Volume minggu tiap item dibagi ke 7 hari dengan faktor hari kantor (bawaan 0,80;
                  1,20; 1,10; 1,15; 1,00; 0,85; 0,90).
                </>,
                <>
                  {b('Isi manual')} untuk mengubah pembagian satu item; totalnya harus tetap sama
                  dengan volume minggu. {b('Pakai faktor')} mengembalikan ke pembagian otomatis.
                </>,
                <>Alokasi ini menjadi {b('Pekerjaan hari ini')} di laporan harian.</>,
              ]}
            />
          </Chapter>

          <Chapter id="harian" title="Laporan harian">
            <Steps
              items={[
                <>
                  Dari halaman minggu, pilih hari di strip H1–H7. Hari yang belum tiba belum bisa
                  dibuka.
                </>,
                <>
                  {b('Pekerjaan hari ini')} berisi kegiatan, volume, dan analisa dari alokasi
                  harian. Item tanpa analisa ditandai {b('tanpa AHSP')}.
                </>,
                <>
                  {b('Tenaga kerja')}, {b('Penggunaan bahan')}, dan {b('Peralatan')}: kolom{' '}
                  {b('Hitungan AHSP')} = volume hari itu × koefisien analisa (termasuk sub-analisa).
                  Isi kolom {b('Aktual')}; {b('pakai hitungan')} menyalin angka hitungan (tenaga
                  kerja dibulatkan ke orang utuh).
                </>,
                <>
                  Nama dan satuan baris boleh diubah, baris kecil disembunyikan (
                  {b('Tampilkan semua')} untuk melihatnya), dan {b('+ Tambah baris')} untuk tenaga
                  atau alat lain (mis. cangkul, gerinda).
                </>,
                <>
                  {b('Cuaca')}: {b('+ Tambah cuaca')}, pilih kondisi dan jam dari–sampai; boleh
                  lebih dari satu dalam sehari. Isi {b('Catatan laporan')} bila perlu.
                </>,
                <>
                  {b('Simpan laporan')}, lalu {b('Finalkan')}. Peringatan boleh dilewati dengan
                  konfirmasi. {b('Besok →')} membuka hari berikutnya.
                </>,
                <>
                  Laporan final terkunci. {b('Revisi')} (MANAGER, alasan wajib) membukanya untuk
                  diubah, lalu finalkan lagi. Bila minggunya terkunci laporan mingguan final, buka
                  kembali laporan mingguan dulu.
                </>,
                <>
                  Laporan hari baru otomatis diisi jumlah orang dan alat dari laporan sebelumnya.
                </>,
                <>
                  {b('Ekspor PDF')} dan {b('Ekspor Excel')}: lihat bab Cetak, PDF, dan Excel.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="mingguan" title="Laporan mingguan">
            <Steps
              items={[
                <>
                  {b('Ajukan laporan')} oleh penginput, setelah minggu berakhir. Hal yang menahan
                  pengajuan tampil di {b('Belum dapat diajukan atau diperiksa')}.
                </>,
                <>
                  {b('Tandai diperiksa')} oleh REVIEWER atau MANAGER yang tidak ikut mengisi progres
                  minggu itu; catatan pemeriksaan opsional.
                </>,
                <>
                  {b('Finalkan')} oleh MANAGER. Isi laporan dibekukan sebagai snapshot, dan progres
                  minggu itu serta sebelumnya terkunci.
                </>,
                <>
                  {b('Buka kembali')} oleh MANAGER dengan alasan, mulai dari minggu final paling
                  akhir.
                </>,
              ]}
            />
            <p>
              Isinya: ringkasan realisasi, rencana, dan deviasi (minggu ini dan bulan ini); waktu
              pelaksanaan total, terpakai, dan sisa; rekap per kelompok (lembar RM); Kurva S sampai
              minggu itu; rangkuman laporan harian (tenaga kerja dalam orang-hari, bahan dan alat);
              detail progres item (lembar M). Rekap per kelompok tampil setelah jadwal versi
              baseline di-approve.
            </p>
          </Chapter>

          <Chapter id="bulanan" title="Laporan bulanan">
            <Steps
              items={[
                <>
                  Tab {b('Laporan bulanan')} di halaman minggu menampilkan periode B.n yang memuat
                  minggu itu.
                </>,
                <>Laporan dirangkum otomatis dari 4 minggunya; tidak perlu diisi atau diajukan.</>,
                <>
                  Tanda {b('Sementara')} berarti ada minggu yang belum final; angkanya masih bisa
                  berubah. Setelah {b('Semua minggu final')}, angkanya tetap.
                </>,
                <>
                  Ekspor dengan {b('Ekspor PDF')} atau {b('Ekspor Excel')}.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="template" title="Template laporan">
            <Steps
              items={[
                <>
                  Tab Informasi → kartu {b('Template laporan')} → {b('Atur template')}. Template
                  berlaku per proyek, terpisah untuk laporan harian, mingguan, dan bulanan. Hanya
                  pemegang izin ubah proyek yang bisa mengubahnya.
                </>,
                <>
                  Unggah logo {b('Pemberi tugas / dinas')}, {b('Konsultan pengawas')}, dan{' '}
                  {b('Kontraktor')}. Logo dipakai di kop semua jenis laporan.
                </>,
                <>
                  {b('Kertas')}: ukuran (A4, F4/Folio, Legal), orientasi, margin, ukuran huruf, dan
                  desimal volume.
                </>,
                <>
                  {b('Layout laporan')}: laporan harian bisa{' '}
                  {b('Kolom berdampingan (format kantor)')} atau {b('Bertumpuk')}, dengan label
                  minggu/hari/tanggal, label cuaca, judul kelompok staf, dan pilihan menampilkan
                  semua staf. Laporan mingguan dan bulanan memakai format kantor: sampul, rekap,
                  progres, dan time schedule, masing-masing satu halaman.
                </>,
                <>
                  {b('Kop dan judul')} (satu baris per baris), {b('Identitas proyek')} (label
                  isian), {b('Bagian laporan dan kolom')} (tampil, judul, urutan), dan tanda tangan
                  (keterangan, jabatan, instansi, nama, NIP).
                </>,
                <>
                  Pratinjau di kanan sama dengan hasil cetak dan memakai data minggu nyata.{' '}
                  {b('Simpan template')} untuk menyimpan, {b('Kembalikan bawaan')} untuk mengulang.
                </>,
                <>
                  {b('Impor template dari proyek lain')} menyalin template (dan logo bila dicentang)
                  dari proyek lain yang bisa Anda buka. Template ketiga jenis laporan diganti.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="excel-kantor" title="File Excel kantor">
            <p>
              Agar hasil ekspor sama persis dengan Excel kantor, unggah workbook kantor di Template
              laporan → jenis laporan → {b('File Excel kantor')} → {b('Unggah file Excel')}. Ekspor
              Excel dan PDF lalu mengisi file itu. Tanpa file ini, ekspor memakai layout template.
            </p>
            <Pairs
              items={[
                [
                  'Laporan harian',
                  'Format Cov.n dan Har.n per minggu (7 blok hari per sheet). Aplikasi mengisi tanggal, tenaga kerja, alat, bahan, pekerjaan, jam cuaca, dan catatan hari itu. Bila sheet Har.n minggu itu belum ada, aplikasi menyalin sheet minggu terakhir menjadi minggu baru di hasil ekspor; file tersimpan tidak berubah.',
                ],
                [
                  'Laporan mingguan',
                  'Sheet C.n, RM.n, M.n, dan Curva S M.n. Aplikasi mengisi % kumulatif per item ke sheet M.n. Sheet M.n minggu itu harus sudah ada di file.',
                ],
                [
                  'Laporan bulanan',
                  'Sheet C.n, RB.n, B.n, dan CS B.n. Sheet B.n berisi kumulatif sampai minggu terakhir periode itu dan harus sudah ada di file.',
                ],
                [
                  'Pencocokan item',
                  'Uraian di sheet progres dicocokkan dengan RAB approved. Bila ada baris yang tidak cocok, ekspor ditolak dengan daftar baris yang bermasalah.',
                ],
                [
                  'Rumus dan keamanan',
                  'Identitas proyek dan tanda tangan tetap rumus file kantor. Rumus yang merujuk file lain diganti nilai tersimpannya saat dicetak; rumus pengambil data dari internet ditolak.',
                ],
              ]}
            />
            <p>
              {b('Ganti file')} mengganti workbook; {b('Hapus')} kembali ke layout template.
            </p>
          </Chapter>

          <Chapter id="ekspor" title="Cetak, PDF, dan Excel">
            <Steps
              items={[
                <>
                  {b('Ekspor Excel')} di laporan harian, mingguan, dan bulanan mengunduh file .xlsx:
                  file Excel kantor yang sudah terisi, atau layout template bila tidak ada file
                  kantor.
                </>,
                <>
                  {b('Ekspor PDF')} dengan file Excel kantor langsung mengunduh PDF yang dicetak
                  server dari file itu (hanya hari, minggu, atau periode itu). Butuh LibreOffice di
                  server.
                </>,
                <>
                  {b('Ekspor PDF')} tanpa file kantor membuka halaman cetak. Tekan{' '}
                  {b('Cetak / Simpan PDF')}, pilih &quot;Simpan sebagai PDF&quot;, ukuran kertas
                  sesuai template, dan matikan header/footer browser.
                </>,
                <>
                  Laporan final memakai data snapshot; tampilannya mengikuti template saat dicetak.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="pekerja" title="Pekerja">
            <Steps
              items={[
                <>
                  Menu {b('Pekerja')} di sidebar berisi daftar pekerja untuk semua proyek. Cari
                  dengan nama, posisi, atau NIK; saring status {b('Aktif')}, {b('Nonaktif')}, atau{' '}
                  {b('Semua')}.
                </>,
                <>
                  {b('Tambah pekerja')} atau {b('Ubah')}: nama, posisi (ada saran), NIK 16 digit,
                  dan foto KTP (opsional, maks. 5 MB). {b('Hapus KTP')} menghapus fotonya.
                </>,
                <>
                  {b('Impor Excel')}: unduh template Excel, isi, unggah. NIK yang sudah terdaftar
                  memperbarui nama dan posisinya. Satu baris salah membatalkan seluruh impor, dan
                  semua kesalahan ditampilkan.
                </>,
                <>
                  NIK lengkap dan foto KTP hanya untuk pemegang {b('Kelola pekerja')}; user lain
                  melihat NIK tersamar. Pekerja {b('Nonaktifkan')}, tidak dihapus, dan bisa{' '}
                  {b('Aktifkan')} lagi.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="admin" title="Pengguna dan akses">
            <p>
              Menu {b('Pengguna')} tampil untuk super admin dan pemegang izin manajemen akses.
              Isinya tiga tab.
            </p>
            <h3>Pengguna</h3>
            <Steps
              items={[
                <>
                  {b('Tambah user')}: nama, email, dan password awal (ada panjang minimum), lalu{' '}
                  {b('Buat user')}. Berikan password awal ke user dan minta ia menggantinya.
                </>,
                <>
                  {b('Ubah')} data user, {b('Nonaktifkan')} / {b('Aktifkan')} (user tidak dihapus),
                  dan {b('Jadikan super admin')} / {b('Cabut super admin')} (khusus super admin).
                </>,
                <>
                  {b('Akses')} membuka akses satu user: {b('Tambah akses proyek')} (pilih proyek dan
                  role, lalu {b('Berikan akses')}), {b('Cabut akses')}, dan role administrasi
                  global.
                </>,
              ]}
            />
            <h3>Role & permission</h3>
            <Steps
              items={[
                <>
                  Ada {b('Role proyek')} (ditugaskan per proyek) dan {b('Role administrasi')}{' '}
                  (global, misalnya Kelola pekerja).
                </>,
                <>
                  {b('Tambah role')}: kode, nama, deskripsi, dan cakupan. Buka role untuk memilih
                  hak akses per modul ({b('Pilih grup')} / {b('Lepas grup')}), lalu{' '}
                  {b('Simpan hak akses')}.
                </>,
                <>
                  Perubahan berlaku untuk semua user yang memakai role itu. Role sistem tidak bisa
                  diubah kode dan statusnya.
                </>,
              ]}
            />
            <h3>Akses proyek</h3>
            <Steps
              items={[
                <>
                  Cari proyek → {b('Lihat anggota & role')}. Halaman ini tidak membuka data proyek.
                </>,
                <>
                  {b('Tambah anggota')}: pilih user aktif dan role, centang konfirmasi, lalu{' '}
                  {b('Tambahkan')}. Ubah role atau {b('Cabut akses')} per anggota. Akses Anda
                  sendiri diatur oleh super admin.
                </>,
              ]}
            />
          </Chapter>

          <Chapter id="angka" title="Angka dan pembulatan">
            <Pairs items={NUMBERS} />
          </Chapter>

          <Chapter id="aturan" title="Aturan yang saling terkait">
            <Pairs items={RULES} />
          </Chapter>

          <Chapter id="faq" title="Pertanyaan umum">
            <Pairs items={FAQ} />
          </Chapter>
        </div>
      </div>
    </>
  );
}
