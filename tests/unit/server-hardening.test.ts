import type { IncomingMessage } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientKey, createApp, parseTrustProxy } from '../../server/app.js';
import { createAssistant } from '../../server/ai.js';

function req(remote: string, xff?: string): IncomingMessage {
  return {
    socket: { remoteAddress: remote },
    headers: xff ? { 'x-forwarded-for': xff } : {},
  } as unknown as IncomingMessage;
}

describe('clientKey', () => {
  it('ignores X-Forwarded-For unless a proxy is trusted', () => {
    expect(clientKey(req('10.0.0.5', '1.2.3.4'), 0)).toBe('10.0.0.5');
  });
  it('uses the entry added by the trusted hop, not a client-supplied prefix', () => {
    // Client spoofs "9.9.9.9", the single trusted proxy appends the real address.
    expect(clientKey(req('10.0.0.5', '9.9.9.9, 1.2.3.4'), 1)).toBe('1.2.3.4');
    expect(clientKey(req('10.0.0.5', '1.2.3.4'), 1)).toBe('1.2.3.4');
    expect(clientKey(req('10.0.0.5', '9.9.9.9, 1.2.3.4, 5.5.5.5'), 2)).toBe('1.2.3.4');
  });
  it('falls back to the socket when the header is missing', () => {
    expect(clientKey(req('10.0.0.5'), 1)).toBe('10.0.0.5');
  });
  it('parses TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toBe(0);
    expect(parseTrustProxy('true')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('nonsense')).toBe(0);
  });
});

describe('static hosting hardening', () => {
  let base = '';
  let server: ReturnType<typeof createApp>['server'];
  beforeAll(async () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'spatialdesk-dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>x</title>');
    writeFileSync(path.join(dist, '.env'), 'SECRET=1');
    mkdirSync(path.join(dist, '.git'));
    writeFileSync(path.join(dist, '.git', 'config'), '[core]');
    const app = createApp({
      assistant: createAssistant({ apiKey: '' }),
      distDir: dist,
      rateLimitPerMinute: 1,
      trustProxy: 1,
    });
    server = app.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('never serves dotfiles even when they exist in dist', async () => {
    expect((await fetch(`${base}/.env`)).status).toBe(404);
    expect((await fetch(`${base}/.git/config`)).status).toBe(404);
    expect((await fetch(`${base}/%2e%2e/.env`)).status).not.toBe(200);
  });
  it('rejects malformed percent-encoding', async () => {
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
  });
  it('reports health without secrets', async () => {
    const body = await (await fetch(`${base}/api/health`)).json();
    expect(body).toMatchObject({ ok: true, assistant: 'not_configured' });
    expect(JSON.stringify(body)).not.toMatch(/ANTHROPIC|key/i);
  });
  it('sets bounded socket timeouts', () => {
    expect(server.headersTimeout).toBe(15_000);
    expect(server.requestTimeout).toBe(60_000);
  });
});
