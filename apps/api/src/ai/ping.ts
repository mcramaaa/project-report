import { z } from 'zod';
import { loadRootEnv } from '../config/env';
import { AI_CANDIDATE_RESPONSE_FORMAT, GUIDE_VERSION, SYSTEM_INSTRUCTION } from '../imports/guide/rab-import-guide';
import { AiClient, readAiConfig } from './ai.client';

/** Connection test with dummy data only (no project data): `npm run ai:ping`. Never prints the API key. */
async function main() {
  loadRootEnv();
  const config = readAiConfig();
  if (!config) throw new Error('9router belum dikonfigurasi (NINEROUTER_BASE_URL, NINEROUTER_API_KEY, AI_MODEL).');
  console.log(`9router ${config.baseUrl} · model ${config.model} · fallback ${config.fallbackModel ?? '-'} · instruksi ${GUIDE_VERSION}`);
  const client = new AiClient(config);
  const schema = z.object({ suggestions: z.array(z.object({ rowKey: z.string(), candidateIds: z.array(z.string()), reason: z.string() })) });
  const dummy = {
    rows: [{ rowKey: 'dummy-1', description: 'Contoh pekerjaan galian (data dummy)', unit: 'm3', sourcePrice: '100', evidence: 'A1 = VLOOKUP("X.1", TABEL, 4)' }],
    candidates: [{ id: 'cand-1', code: 'X.1', name: 'ANALISA CONTOH', unit: 'm3', price: '100' }],
  };
  const { result, model, attempts } = await client.completeJson(schema, [
    { role: 'system', content: SYSTEM_INSTRUCTION },
    { role: 'user', content: `Ini uji koneksi dengan data dummy. Usulkan kandidat untuk setiap baris. Format jawaban: ${AI_CANDIDATE_RESPONSE_FORMAT}\n${JSON.stringify(dummy)}` },
  ]);
  for (const a of attempts) console.log(`- ${a.model} percobaan ${a.attempt}: ${a.status}${a.error ? ` (${a.error})` : ''} ${a.finishedAt.getTime() - a.startedAt.getTime()} ms`);
  if (!result) throw new Error('Kedua model gagal; impor tetap dapat diselesaikan lewat review manual.');
  console.log(`OK: dijawab oleh ${model}: ${JSON.stringify(result)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
