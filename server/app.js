// @ts-check
/**
 * HTTP application for SpatialDesk AI: static hosting for the built client and
 * the /api routes. Kept dependency-free (node:http) so deployment is a single
 * `node server/index.js`.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssistant, AssistantError } from './ai.js';
import { RateLimiter } from './rate-limit.js';
import { AssistRequest, MAX_INPUT_CHARS } from './schemas.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = path.resolve(here, '..', 'dist');

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.uikitml': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_BODY_BYTES = 256 * 1024;

/**
 * @param {{
 *   assistant?: ReturnType<typeof createAssistant>,
 *   distDir?: string,
 *   rateLimitPerMinute?: number,
 *   allowedOrigins?: string[],
 *   version?: string,
 *   trustProxy?: number,
 * }} options
 */
export function createApp(options = {}) {
  const assistant = options.assistant ?? createAssistant();
  const distDir = options.distDir ?? DIST_DIR;
  const limiter = new RateLimiter({
    limit: options.rateLimitPerMinute ?? Number(process.env.AI_RATE_LIMIT_PER_MINUTE ?? 20),
    windowMs: 60_000,
  });
  const allowedOrigins = new Set(
    options.allowedOrigins ??
      (process.env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
  );
  const version = options.version ?? process.env.npm_package_version ?? '0.0.0';
  // Number of reverse-proxy hops in front of the server whose X-Forwarded-For
  // entries can be trusted (0 = none; use the socket address). Hosts such as
  // Render or Fly put exactly one proxy in front of the app.
  const trustProxy = options.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY);
  const startedAt = Date.now();

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    applySecurityHeaders(res);
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  async function handleApi(req, res, url) {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        assistant: assistant.configured ? 'configured' : 'not_configured',
      });
      return;
    }
    if (url.pathname === '/api/ai/status' && req.method === 'GET') {
      sendJson(res, 200, {
        configured: assistant.configured,
        provider: 'anthropic',
        model: assistant.configured ? assistant.model : null,
        limits: { maxInputChars: MAX_INPUT_CHARS },
      });
      return;
    }
    if (url.pathname === '/api/ai/assist' && req.method === 'POST') {
      await handleAssist(req, res);
      return;
    }
    sendJson(res, 404, { error: { code: 'not_found', message: 'Unknown API route.' } });
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleAssist(req, res) {
    if (!assistant.configured) {
      sendJson(res, 503, {
        error: {
          code: 'not_configured',
          message: 'The AI assistant is not configured on this server.',
        },
      });
      return;
    }
    if (!/^application\/json/i.test(String(req.headers['content-type'] ?? ''))) {
      sendJson(res, 415, { error: { code: 'bad_request', message: 'Send JSON.' } });
      return;
    }
    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      const status = error instanceof PayloadTooLarge ? 413 : 400;
      sendJson(res, status, {
        error: { code: 'bad_request', message: /** @type {Error} */ (error).message },
      });
      return;
    }
    const parsed = AssistRequest.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, {
        error: {
          code: 'bad_request',
          message: 'The request did not match the expected shape.',
          issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
        },
      });
      return;
    }
    // Only well-formed requests count against the per-client budget.
    const verdict = limiter.hit(clientKey(req, trustProxy));
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(verdict.retryAfterMs / 1000)));
      sendJson(res, 429, {
        error: {
          code: 'rate_limited',
          message: 'Too many assistant requests. Please wait a moment.',
        },
      });
      return;
    }
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on('close', onClose);
    try {
      const result = await assistant.assist(parsed.data, controller.signal);
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof AssistantError) {
        if (error.status === 499) return; // client went away
        sendJson(res, error.status, { error: { code: error.code, message: error.message } });
      } else {
        console.error('[api/ai/assist] unexpected failure', error);
        sendJson(res, 500, {
          error: { code: 'provider_error', message: 'Unexpected server error.' },
        });
      }
    } finally {
      req.off('close', onClose);
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (!existsSync(distDir)) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The client has not been built. Run `npm run build` first.');
      return;
    }
    let relative;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Never serve dotfiles or dot-directories (.env, .git, .well-known is not used).
    if (relative.split('/').some((segment) => segment.startsWith('.'))) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    let filePath = path.resolve(distDir, relative || 'index.html');
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      // Hash-routed single page app: unknown paths without a file extension get index.html.
      if (path.extname(relative) !== '') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const immutable = /^assets\//.test(path.relative(distDir, filePath).replace(/\\/g, '/'));
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Length': statSync(filePath).size,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('[server] request failed', error);
      if (!res.headersSent)
        sendJson(res, 500, { error: { code: 'server_error', message: 'Server error.' } });
      else res.end();
    });
  });
  // Bound slow clients: headers within 15 s, whole request within 60 s; keep
  // idle keep-alive sockets slightly longer than typical load-balancer timeouts.
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 65_000;
  return { server, assistant, limiter };
}

class PayloadTooLarge extends Error {}

/** @param {import('node:http').IncomingMessage} req */
function readJson(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PayloadTooLarge('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        reject(new Error('Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Identify the client for rate limiting. X-Forwarded-For is only consulted for
 * the configured number of trusted proxy hops, so a client cannot spoof its
 * way past the limiter by sending the header itself.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} trustProxy
 */
export function clientKey(req, trustProxy = 0) {
  const socketAddress = req.socket?.remoteAddress ?? 'unknown';
  if (trustProxy <= 0) return socketAddress;
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  const hops = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return socketAddress;
  // The rightmost `trustProxy` entries were appended by proxies we trust; the
  // entry just before them is the real client as seen by the first trusted proxy.
  const index = hops.length - trustProxy;
  return hops[index >= 0 ? index : 0] ?? socketAddress;
}

/** @param {string | undefined} value */
export function parseTrustProxy(value) {
  if (!value) return 0;
  if (value === 'true') return 1;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** @param {import('node:http').ServerResponse} res */
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Permissions-Policy',
    'xr-spatial-tracking=(self), microphone=(self), camera=(), geolocation=(), payment=()',
  );
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://cdn.jsdelivr.net",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
