import type { z } from 'zod';

/**
 * OpenAI-compatible client for the local 9router (D-052). Called only from apps/api. Primary model first,
 * fallback model after technical failures; every attempt is recorded (never the API key). A null result
 * means "no AI help": the import continues through manual review.
 */
export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModel: string | null;
  timeoutMs: number;
  /** Attempts per model (network/timeout/5xx/429/invalid output are retried). */
  attemptsPerModel: number;
}

export interface AiAttempt {
  model: string;
  attempt: number;
  status: 'SUCCEEDED' | 'FAILED';
  error: string | null;
  response: unknown;
  startedAt: Date;
  finishedAt: Date;
}

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const baseUrl = env.NINEROUTER_BASE_URL?.trim();
  const apiKey = env.NINEROUTER_API_KEY?.trim();
  const model = env.AI_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  const timeout = Number(env.AI_TIMEOUT_MS ?? 60000);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model,
    fallbackModel: env.AI_FALLBACK_MODEL?.trim() || null,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60000,
    attemptsPerModel: 2,
  };
}

class TechnicalError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class AiClient {
  constructor(
    private readonly config: AiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  get models(): string[] {
    return [this.config.model, ...(this.config.fallbackModel && this.config.fallbackModel !== this.config.model ? [this.config.fallbackModel] : [])];
  }

  async completeJson<T>(schema: z.ZodType<T>, messages: AiMessage[]): Promise<{ result: T | null; model: string | null; attempts: AiAttempt[] }> {
    const attempts: AiAttempt[] = [];
    for (const model of this.models) {
      for (let attempt = 1; attempt <= this.config.attemptsPerModel; attempt++) {
        const startedAt = new Date();
        try {
          const { parsed, raw } = await this.call(model, messages, schema);
          attempts.push({ model, attempt, status: 'SUCCEEDED', error: null, response: raw, startedAt, finishedAt: new Date() });
          return { result: parsed, model, attempts };
        } catch (err) {
          const technical = err instanceof TechnicalError ? err : new TechnicalError(err instanceof Error ? err.message : String(err), true);
          attempts.push({ model, attempt, status: 'FAILED', error: technical.message, response: null, startedAt, finishedAt: new Date() });
          if (!technical.retryable) break; // e.g. unknown model: go straight to the fallback
          if (attempt < this.config.attemptsPerModel) await this.sleep(500 * attempt);
        }
      }
    }
    return { result: null, model: null, attempts };
  }

  private async call<T>(model: string, messages: AiMessage[], schema: z.ZodType<T>): Promise<{ parsed: T; raw: unknown }> {
    // One deadline for the whole exchange: headers and body (SSE included) — a stalled stream must still time out.
    const controller = new AbortController();
    const timedOut = () => new TechnicalError(`timeout setelah ${this.config.timeoutMs} ms`, true);
    const deadline = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(timedOut()), { once: true }));
    deadline.catch(() => undefined);
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const read = (res: Response) =>
      Promise.race([res.text(), deadline]).catch((err: unknown) => {
        throw err instanceof TechnicalError ? err : controller.signal.aborted ? timedOut() : new TechnicalError(`respons terputus: ${(err as Error).message}`, true);
      });
    let body: string;
    try {
      const res = await Promise.race([
        this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify({ model, messages, temperature: 0, stream: false, response_format: { type: 'json_object' } }),
          signal: controller.signal,
        }),
        deadline,
      ]).catch((err: unknown) => {
        throw err instanceof TechnicalError ? err : controller.signal.aborted ? timedOut() : new TechnicalError(`koneksi gagal: ${(err as Error).message}`, true);
      });
      if (!res.ok) {
        const text = (await read(res).catch((err: unknown) => (controller.signal.aborted ? Promise.reject(err) : ''))).slice(0, 300);
        throw new TechnicalError(`HTTP ${res.status}${text ? `: ${text}` : ''}`, res.status >= 500 || res.status === 429 || res.status === 408);
      }
      body = await read(res);
    } finally {
      clearTimeout(timer);
      controller.abort(); // releases a body still streaming after an error
    }
    const content = messageContent(body);
    if (typeof content !== 'string') throw new TechnicalError('respons tanpa konten', true);
    let json: unknown;
    try {
      json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new TechnicalError('konten bukan JSON', true);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new TechnicalError(`JSON tidak sesuai schema: ${parsed.error.issues[0]?.message ?? 'tidak valid'}`, true);
    return { parsed: parsed.data, raw: json };
  }
}

/** Assistant text from a chat completion, or from an SSE stream some routes send even with stream:false. */
export function messageContent(body: string): string | undefined {
  const text = body.trim();
  if (text.startsWith('data:')) {
    let out = '';
    for (const line of text.split('\n')) {
      const data = line.replace(/^data:\s*/, '').trim();
      if (!line.startsWith('data:') || !data || data === '[DONE]') continue;
      try {
        const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] };
        out += chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? '';
      } catch {
        return undefined;
      }
    }
    return out || undefined;
  }
  try {
    const payload = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    return payload.choices?.[0]?.message?.content;
  } catch {
    return undefined;
  }
}
