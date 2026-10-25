import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiClient, readAiConfig, type AiConfig } from './ai.client';

const config: AiConfig = { baseUrl: 'http://router/v1', apiKey: 'sk-secret-test', model: 'primary', fallbackModel: 'backup', timeoutMs: 50, attemptsPerModel: 2 };
const schema = z.object({ ok: z.boolean() });
const reply = (content: string, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
const noSleep = () => Promise.resolve();

describe('readAiConfig', () => {
  it('reads primary and fallback models; returns null when not configured', () => {
    expect(readAiConfig({ NINEROUTER_BASE_URL: 'http://localhost:20128/v1/', NINEROUTER_API_KEY: 'k', AI_MODEL: 'cc/a', AI_FALLBACK_MODEL: 'cx/b' })).toMatchObject({
      baseUrl: 'http://localhost:20128/v1',
      model: 'cc/a',
      fallbackModel: 'cx/b',
      timeoutMs: 60000,
    });
    expect(readAiConfig({ NINEROUTER_BASE_URL: 'x', NINEROUTER_API_KEY: '', AI_MODEL: 'm' })).toBeNull();
    expect(readAiConfig({ NINEROUTER_BASE_URL: 'x', NINEROUTER_API_KEY: 'k', AI_MODEL: 'm' })!.fallbackModel).toBeNull();
  });
});

describe('AiClient', () => {
  it('uses the primary model when it answers valid JSON', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'));
    const out = await new AiClient(config, fetchImpl as typeof fetch, noSleep).completeJson(schema, [{ role: 'user', content: 'x' }]);
    expect(out).toMatchObject({ result: { ok: true }, model: 'primary' });
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ model: 'primary', temperature: 0 });
  });

  it('retries technical failures, then falls back; records every attempt without the API key', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream down', { status: 502 }))
      .mockResolvedValueOnce(reply('not json'))
      .mockResolvedValueOnce(reply('{"ok":true}'));
    const out = await new AiClient(config, fetchImpl as typeof fetch, noSleep).completeJson(schema, [{ role: 'user', content: 'x' }]);
    expect(out.result).toEqual({ ok: true });
    expect(out.model).toBe('backup');
    expect(out.attempts.map((a) => [a.model, a.attempt, a.status])).toEqual([
      ['primary', 1, 'FAILED'],
      ['primary', 2, 'FAILED'],
      ['backup', 1, 'SUCCEEDED'],
    ]);
    expect(out.attempts[0]!.error).toContain('HTTP 502');
    expect(out.attempts[1]!.error).toContain('bukan JSON');
    expect(JSON.stringify(out)).not.toContain('sk-secret-test');
  });

  it('does not retry the same model on a client error and moves to the fallback', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('unknown model', { status: 404 })).mockResolvedValueOnce(reply('{"ok":false}'));
    const out = await new AiClient(config, fetchImpl as typeof fetch, noSleep).completeJson(schema, [{ role: 'user', content: 'x' }]);
    expect(out.attempts.map((a) => [a.model, a.status])).toEqual([
      ['primary', 'FAILED'],
      ['backup', 'SUCCEEDED'],
    ]);
  });

  it('times out, rejects schema-invalid output, and returns null when both models fail', async () => {
    const hang = (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const fetchImpl = vi.fn().mockImplementationOnce(hang).mockResolvedValueOnce(reply('{"ok":"yes"}')).mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await new AiClient(config, fetchImpl as typeof fetch, noSleep).completeJson(schema, [{ role: 'user', content: 'x' }]);
    expect(out).toMatchObject({ result: null, model: null });
    expect(out.attempts.map((a) => a.error)).toEqual([
      expect.stringContaining('timeout'),
      expect.stringContaining('schema'),
      expect.stringContaining('ECONNREFUSED'),
      expect.stringContaining('ECONNREFUSED'),
    ]);
  });

  it('the timeout covers a body or SSE stream that stalls after the headers; retry, fallback, then manual review (regression)', async () => {
    // Headers arrive, then the stream never ends and ignores the abort signal.
    const stalled = () => Promise.resolve(new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{"}}]}\n')) }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const fetchImpl = vi.fn().mockImplementationOnce(stalled).mockImplementationOnce(stalled).mockResolvedValueOnce(reply('{"ok":true}'));
    const out = await new AiClient(config, fetchImpl as typeof fetch, noSleep).completeJson(schema, []);
    expect(out).toMatchObject({ result: { ok: true }, model: 'backup' });
    expect(out.attempts.map((a) => [a.model, a.status, a.error])).toEqual([
      ['primary', 'FAILED', expect.stringContaining('timeout')],
      ['primary', 'FAILED', expect.stringContaining('timeout')],
      ['backup', 'SUCCEEDED', null],
    ]);

    const allStalled = await new AiClient(config, vi.fn(stalled) as typeof fetch, noSleep).completeJson(schema, []);
    expect(allStalled).toMatchObject({ result: null, model: null });
    expect(allStalled.attempts).toHaveLength(4);
  });

  it('reads SSE streams that some routes return even with stream:false', async () => {
    const sse = ['data: {"choices":[{"delta":{"role":"assistant"}}]}', 'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}', 'data: {"choices":[{"delta":{"content":"true}"}}]}', 'data: [DONE]'].join('\n\n');
    const fetchImpl = vi.fn(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const out = await new AiClient(config, fetchImpl as typeof fetch, noSleep).completeJson(schema, []);
    expect(out).toMatchObject({ result: { ok: true }, model: 'primary' });
  });

  it('without a fallback model only the primary is tried', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    const out = await new AiClient({ ...config, fallbackModel: null }, fetchImpl as typeof fetch, noSleep).completeJson(schema, []);
    expect(out.attempts).toHaveLength(2);
  });
});
