import { WORD_MATCHES } from '@laporan-proyek/shared';
import { z } from 'zod';

/** RAB_PLAYGROUND stage 3 (D-095): instructions for the mapping profile assistant. Bump on every change. */
export const PROFILE_ASSIST_VERSION = 'rab-profile-assist@1';

export const PROFILE_ASSIST_INSTRUCTION = `Anda membantu reviewer menyusun profil pemetaan workbook RAB konstruksi.
Profil hanya berisi kata judul kolom dan label yang dicari pembaca, per peran (role), dengan cara cocok:
EXACT = teks sel sama persis; PREFIX = teks sel diawali kata; WORD = diawali kata sebagai kata utuh; CONTAINS = memuat kata.
Teks sel dibandingkan dalam huruf besar dengan spasi tunggal; judul boleh tersebar di dua baris (baris itu dan berikutnya).

Aturan:
- Anda TIDAK memberi angka. Volume, harga, koefisien, dan total selalu dibaca sistem dari sel Excel.
- Setiap kata yang Anda usulkan WAJIB menyebut alamat sel tempat kata itu tertulis di workbook ("Sheet!B3"). Kata tanpa sel yang
  benar-benar memuatnya ditolak sistem.
- Hanya usulkan role dari daftar "roles" pada input. Usulan menambah kata ke role itu, tidak menghapus kata yang ada.
- Pakai cara cocok yang sama dengan aturan role yang ada kecuali role itu "many" (boleh aturan baru dengan cara cocok lain).
- Jika masalahnya bukan soal kata judul (misalnya rumus rusak atau data kosong), jelaskan di "reply" dan jangan usulkan perubahan.
- Jawab dalam bahasa Indonesia, singkat, sebut sel yang menjadi bukti.`;

export const profileAssistResponseSchema = z.object({
  reply: z.string().max(4000),
  changes: z
    .array(
      z.object({
        role: z.string().max(80),
        match: z.enum(WORD_MATCHES),
        words: z.array(z.object({ word: z.string().max(60), cell: z.string().max(140) })).min(1).max(10),
        reason: z.string().max(1000),
      }),
    )
    .max(10),
});
export type ProfileAssistResponse = z.infer<typeof profileAssistResponseSchema>;

export const PROFILE_ASSIST_RESPONSE_FORMAT = `{"reply":"<jawaban untuk reviewer>","changes":[{"role":"<path role dari daftar roles>","match":"EXACT|PREFIX|WORD|CONTAINS","words":[{"word":"<KATA>","cell":"<Sheet!A1 tempat kata tertulis>"}],"reason":"<alasan singkat>"}]}`;
