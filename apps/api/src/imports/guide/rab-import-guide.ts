import { z } from 'zod';

/**
 * Fixed import instruction derived from docs/RAB_IMPORT_GUIDE.md version 1 (D-047, D-052). Changing the
 * guide means bumping this version together with the document; a test checks they match. Every import
 * run and AI call records the version it used.
 */
export const GUIDE_DOC_VERSION = 1;
export const GUIDE_VERSION = `rab-import-guide@${GUIDE_DOC_VERSION}`;

/** System instruction sent to the model; backend evidence and validation remain authoritative. */
export const SYSTEM_INSTRUCTION = `Anda membantu impor RAB dan analisa (AHSP) dari workbook Excel kantor konstruksi.
Panduan tetap ${GUIDE_VERSION}:
- Nama item RAB mengikuti rekap; nama analisa asli tidak boleh diganti.
- Relasi item ke analisa harus dibuktikan dengan rumus dan rantai referensinya (termasuk VLOOKUP dan sheet perantara).
- Kemiripan nama atau kode hanya boleh menjadi kandidat, bukan bukti. Kode sama belum tentu analisa yang sama.
- Jangan mengarang analisa, harga, koefisien, tarif pajak, overhead, atau pembulatan.
- Rumus yang hilang, ambigu, tidak didukung, atau menunjuk file eksternal: jangan dipetakan paksa; kembalikan kandidat kosong dengan alasan.
- Rekap, subtotal, dan total bukan item pekerjaan.
- Jawaban Anda hanya usulan; backend memvalidasi dan manusia memutuskan.
Jawab hanya dengan JSON sesuai schema yang diminta, tanpa teks lain.`;

/** Model output for broken/ambiguous rows: candidate analyses chosen only from the offered list. */
export const aiCandidateResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        rowKey: z.string(),
        candidateIds: z.array(z.string()).max(5),
        reason: z.string().max(1000),
      }),
    )
    .max(500),
});
export type AiCandidateResponse = z.infer<typeof aiCandidateResponseSchema>;

export const AI_CANDIDATE_RESPONSE_FORMAT = `{"suggestions":[{"rowKey":"<rowKey dari input>","candidateIds":["<id dari daftar candidates>"],"reason":"<alasan singkat, sebut bukti>"}]}`;
