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

/** D-096: chat about one import run. The answer is about the run's draft; numbers still come only from cells. */
export const RAB_IMPORT_CHAT_VERSION = 'rab-import-chat@2';

export const RAB_IMPORT_CHAT_INSTRUCTION = `Anda membantu reviewer memeriksa HASIL impor RAB yang sudah dibaca sistem (draft run).
Sistem sudah membaca workbook dengan profil run ini. Anda menerima: hasil sistem (masalah dan baris yang belum tertaut),
sel di sekitar masalah, dan riwayat chat. Tugas Anda:
- Jawab pertanyaan reviewer tentang kenapa suatu baris atau masalah terjadi, dengan menunjuk sel buktinya.
- Jika penyebabnya kata judul kolom atau label yang tidak dikenali profil, usulkan kata itu lewat "changes" (sel bukti wajib).
- Jika penyebabnya bukan kata judul (rumus rusak, data kosong, analisa tidak ada), jelaskan di "reply" dan jangan usulkan perubahan.
- Anda tidak pernah memberi angka, dan tidak menyimpan atau menerapkan apa pun. Reviewer yang memutuskan.

Usulan "edits" mengubah satu item RAB: volume, satuan, PPN, atau deskripsi. Nilai harus sama dengan isi sel yang Anda sebut
di "cell", dan hanya untuk item yang kodenya ada di daftar masalah atau baris belum tertaut. Harga tidak pernah diedit lewat usulan.
Aturan kata profil tetap berlaku: setiap kata wajib menyebut sel yang memuatnya; sistem membuktikan usulan itu sebelum dipakai.
Jawab dalam bahasa Indonesia, singkat, sebut sel yang menjadi bukti.`;

/** D-096: a chat answer: profile words (as stage 3) plus item edits the workbook cell must prove. */
export const rabImportChatResponseSchema = profileAssistResponseSchema.extend({
  edits: z
    .array(
      z.object({
        itemCode: z.string().trim().min(1).max(30),
        field: z.enum(['volume', 'unit', 'taxPercent', 'description']),
        value: z.string().trim().min(1).max(1000),
        cell: z.string().max(140),
        reason: z.string().max(1000),
      }),
    )
    .max(10)
    .default([]),
});
export type RabImportChatResponse = z.infer<typeof rabImportChatResponseSchema>;

export const RAB_IMPORT_CHAT_RESPONSE_FORMAT = `{"reply":"<jawaban untuk reviewer>","changes":[{"role":"<path role>","match":"EXACT|PREFIX|WORD|CONTAINS","words":[{"word":"<KATA>","cell":"<Sheet!A1>"}],"reason":"<alasan>"}],"edits":[{"itemCode":"<kode item seperti ditampilkan RAB>","field":"volume|unit|taxPercent|description","value":"<nilai yang benar>","cell":"<Sheet!A1 tempat nilai itu ada di workbook>","reason":"<alasan>"}]}`;
