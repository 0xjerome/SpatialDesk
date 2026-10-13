import { describe, expect, it } from 'vitest';
import { AssistError, AssistantClient, friendlyAssistMessage } from '../../src/ai/client';
import type { Task } from '../../src/domain/types';

const task: Task = {
  id: 't1',
  title: 'Write docs',
  description: '',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  projectId: null,
  createdAt: '',
  updatedAt: '',
  completedAt: null,
};

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init))) as typeof fetch;
}

describe('AssistantClient', () => {
  it('reports status and tolerates an unreachable server', async () => {
    const ok = new AssistantClient({ fetchImpl: fakeFetch(() => Response.json({ configured: true, provider: 'anthropic', model: 'm', limits: { maxInputChars: 10 } })) });
    expect(await ok.status()).toEqual({ configured: true, provider: 'anthropic', model: 'm', maxInputChars: 10, unreachable: false });
    const down = new AssistantClient({ fetchImpl: fakeFetch(() => { throw new Error('ECONNREFUSED'); }) });
    expect((await down.status()).unreachable).toBe(true);
  });

  it('maps a not-configured server to a typed error', async () => {
    const client = new AssistantClient({
      fetchImpl: fakeFetch(() => Response.json({ error: { code: 'not_configured', message: 'x' } }, { status: 503 })),
    });
    await expect(client.summarize('t', 'text')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('maps rate limits and unknown statuses', async () => {
    const limited = new AssistantClient({ fetchImpl: fakeFetch(() => Response.json({}, { status: 429 })) });
    await expect(limited.summarize('t', 'x')).rejects.toMatchObject({ code: 'rate_limited' });
    const broken = new AssistantClient({ fetchImpl: fakeFetch(() => Response.json({}, { status: 500 })) });
    await expect(broken.summarize('t', 'x')).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('rejects malformed success payloads so nothing bad is shown', async () => {
    const client = new AssistantClient({
      fetchImpl: fakeFetch(() => Response.json({ action: 'summarize', result: { summary: 42 } })),
    });
    await expect(client.summarize('t', 'x')).rejects.toMatchObject({ code: 'invalid_output' });
    const wrongAction = new AssistantClient({
      fetchImpl: fakeFetch(() => Response.json({ action: 'organize_tasks', result: { groups: [], suggestions: [] } })),
    });
    await expect(wrongAction.summarize('t', 'x')).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('returns validated results and sends the expected body', async () => {
    let sent: unknown = null;
    const client = new AssistantClient({
      fetchImpl: fakeFetch((_url, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ action: 'organize_tasks', result: { groups: [{ name: 'G', taskIds: ['t1'], rationale: '' }], suggestions: [] }, model: 'm' });
      }),
    });
    const r = await client.organizeTasks([task]);
    expect(r.result.groups[0]?.taskIds).toEqual(['t1']);
    expect(sent).toMatchObject({ action: 'organize_tasks', input: { tasks: [{ id: 't1', title: 'Write docs' }] } });
  });

  it('times out', async () => {
    const client = new AssistantClient({
      timeoutMs: 10,
      fetchImpl: ((_: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch,
    });
    await expect(client.summarize('t', 'x')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const client = new AssistantClient({
      fetchImpl: ((_: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch,
    });
    const p = client.summarize('t', 'x', controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('has friendly messages', () => {
    expect(friendlyAssistMessage(new AssistError('not_configured', 'x'))).toMatch(/ANTHROPIC_API_KEY/);
    expect(friendlyAssistMessage(new Error('x'))).toMatch(/Something went wrong/);
  });
});
