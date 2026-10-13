import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../server/app.js';
import { buildAssistRequest, createAssistant, AssistantError, mapProviderError } from '../../server/ai.js';
import { RateLimiter } from '../../server/rate-limit.js';
import { AssistRequest, OrganizeTasksOutput } from '../../server/schemas.js';

type Server = ReturnType<typeof createApp>['server'];

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('request schemas', () => {
  it('accepts a valid summarize request and rejects junk', () => {
    expect(AssistRequest.safeParse({ action: 'summarize', input: { text: 'hello' } }).success).toBe(true);
    expect(AssistRequest.safeParse({ action: 'summarize', input: { text: '' } }).success).toBe(false);
    expect(AssistRequest.safeParse({ action: 'explode', input: {} }).success).toBe(false);
    expect(AssistRequest.safeParse({ action: 'organize_tasks', input: { tasks: [], today: '2026-01-01' } }).success).toBe(false);
  });
  it('validates model output', () => {
    expect(OrganizeTasksOutput.safeParse({ groups: [], suggestions: [] }).success).toBe(true);
    expect(OrganizeTasksOutput.safeParse({ groups: [{ name: '', taskIds: [], rationale: '' }], suggestions: [] }).success).toBe(false);
  });
  it('builds prompts from supplied material only', () => {
    const parsed = AssistRequest.parse({
      action: 'break_down_project',
      input: { project: { name: 'Launch', description: 'Ship v1' }, existingTasks: ['Write README'] },
    });
    const { prompt } = buildAssistRequest(parsed);
    expect(prompt).toContain('Project: Launch');
    expect(prompt).toContain('- Write README');
  });
});

describe('assistant without credentials', () => {
  it('is reported as not configured and refuses to call out', async () => {
    const assistant = createAssistant({ apiKey: '' });
    expect(assistant.configured).toBe(false);
    await expect(assistant.assist(AssistRequest.parse({ action: 'summarize', input: { text: 'x' } }))).rejects.toMatchObject({
      code: 'not_configured',
      status: 503,
    });
  });
  it('maps unknown errors conservatively', () => {
    expect(mapProviderError(new Error('boom'))).toBeInstanceOf(AssistantError);
    expect(mapProviderError(new Error('boom')).code).toBe('provider_error');
  });
});

describe('assistant with a fake provider client', () => {
  function fakeClient(text: string, stop = 'end_turn') {
    return {
      beta: {
        messages: {
          create: async () => ({ stop_reason: stop, model: 'fake', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 2 } }),
        },
      },
    } as unknown as NonNullable<Parameters<typeof createAssistant>[0]>['client'];
  }
  const req = AssistRequest.parse({ action: 'summarize', input: { title: 't', text: 'The spec says hands are supported.' } });

  it('returns validated output', async () => {
    const assistant = createAssistant({ client: fakeClient(JSON.stringify({ summary: 'Hands are supported.', keyPoints: [], actionItems: [] })) });
    const result = await assistant.assist(req);
    expect(result).toMatchObject({ action: 'summarize', result: { summary: 'Hands are supported.' }, model: 'fake' });
  });
  it('rejects malformed JSON and wrong shapes', async () => {
    await expect(createAssistant({ client: fakeClient('not json') }).assist(req)).rejects.toMatchObject({ code: 'invalid_output' });
    await expect(createAssistant({ client: fakeClient(JSON.stringify({ summary: 5 })) }).assist(req)).rejects.toMatchObject({ code: 'invalid_output' });
  });
  it('surfaces refusals and truncation', async () => {
    await expect(createAssistant({ client: fakeClient('{}', 'refusal') }).assist(req)).rejects.toMatchObject({ code: 'provider_error' });
    await expect(createAssistant({ client: fakeClient('{"summary":"x"', 'max_tokens') }).assist(req)).rejects.toMatchObject({ code: 'invalid_output' });
  });
});

describe('HTTP app', () => {
  let base = '';
  let server: Server;
  beforeAll(async () => {
    const app = createApp({ assistant: createAssistant({ apiKey: '' }), rateLimitPerMinute: 3, distDir: '/nonexistent-dist' });
    server = app.server;
    base = await listen(server);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('serves health and status', async () => {
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true });
    const status = await fetch(`${base}/api/ai/status`);
    expect(status.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await status.json()).toMatchObject({ configured: false, provider: 'anthropic', model: null });
  });

  it('returns 503 for assist when not configured', async () => {
    const res = await fetch(`${base}/api/ai/assist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'summarize', input: { text: 'x' } }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: 'not_configured' } });
  });

  it('404s unknown api routes and 503s when the client is not built', async () => {
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(503);
  });
});

describe('HTTP app with a configured fake assistant', () => {
  let base = '';
  let server: Server;
  beforeAll(async () => {
    const assistant = {
      configured: true,
      model: 'fake',
      assist: async (request: { action: string }) => ({ action: request.action, result: { summary: 'ok', keyPoints: [], actionItems: [] }, model: 'fake', usage: { inputTokens: 0, outputTokens: 0 } }),
    } as unknown as ReturnType<typeof createAssistant>;
    const app = createApp({ assistant, rateLimitPerMinute: 2, distDir: '/nonexistent-dist' });
    server = app.server;
    base = await listen(server);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (body: unknown, headers: Record<string, string> = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}/api/ai/assist`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('validates bodies before calling the provider', async () => {
    expect((await post({ action: 'summarize', input: { text: '' } })).status).toBe(400);
    expect((await post('{bad json')).status).toBe(400);
    expect((await post('x', { 'Content-Type': 'text/plain' })).status).toBe(415);
  });
  it('answers and then rate limits', async () => {
    const ok = await post({ action: 'summarize', input: { text: 'x' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ action: 'summarize', result: { summary: 'ok' } });
    // Limit is 2 per minute and the invalid bodies above did not count.
    const second = await post({ action: 'summarize', input: { text: 'x' } });
    expect(second.status).toBe(200);
    const definitelyLimited = await post({ action: 'summarize', input: { text: 'x' } });
    expect(definitelyLimited.status).toBe(429);
    expect(definitelyLimited.headers.get('retry-after')).toBeTruthy();
  });
});

describe('RateLimiter', () => {
  it('resets after the window', () => {
    let t = 0;
    const rl = new RateLimiter({ limit: 2, windowMs: 1000, now: () => t });
    expect(rl.hit('a').allowed).toBe(true);
    expect(rl.hit('a').allowed).toBe(true);
    expect(rl.hit('a')).toMatchObject({ allowed: false, retryAfterMs: 1000 });
    t = 1001;
    expect(rl.hit('a').allowed).toBe(true);
  });
});
