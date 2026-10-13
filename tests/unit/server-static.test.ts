import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { createAssistant } from '../../server/ai.js';

describe('static hosting', () => {
  let base = '';
  let server: ReturnType<typeof createApp>['server'];
  beforeAll(async () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'spatialdesk-dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>SpatialDesk</title>');
    mkdirSync(path.join(dist, 'assets'));
    writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(path.join(dist, 'manifest.webmanifest'), '{}');
    const app = createApp({ assistant: createAssistant({ apiKey: '' }), distDir: dist });
    server = app.server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('serves the entry page with security headers', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('permissions-policy')).toContain('xr-spatial-tracking=(self)');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await res.text()).toContain('SpatialDesk');
  });

  it('serves hashed assets as immutable with the right MIME type', async () => {
    const res = await fetch(`${base}/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
    const manifest = await fetch(`${base}/manifest.webmanifest`);
    expect(manifest.headers.get('content-type')).toContain('application/manifest+json');
  });

  it('falls back to index.html for extension-less paths and 404s missing files', async () => {
    expect((await fetch(`${base}/some/client/route`)).status).toBe(200);
    expect((await fetch(`${base}/missing.png`)).status).toBe(404);
  });

  it('blocks path traversal', async () => {
    const res = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    expect([403, 404]).toContain(res.status);
    const res2 = await fetch(`${base}/assets/../../../../etc/passwd`);
    expect([403, 404, 200]).toContain(res2.status);
    if (res2.status === 200) expect(await res2.text()).not.toContain('root:');
  });

  it('rejects unsupported methods on static paths', async () => {
    expect((await fetch(`${base}/`, { method: 'DELETE' })).status).toBe(405);
  });
});
