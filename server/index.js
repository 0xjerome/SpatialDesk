// @ts-check
/**
 * Production entry point: `node server/index.js`
 * Serves ./dist and the /api routes. Reads configuration from the environment
 * (see .env.example). A missing ANTHROPIC_API_KEY is not fatal: the assistant
 * reports itself as not configured and the rest of the app keeps working.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadDotEnv } from './env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.resolve(here, '..', '.env'));

const pkg = JSON.parse(readFileSync(path.resolve(here, '..', 'package.json'), 'utf8'));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';

const { server, assistant } = createApp({ version: pkg.version });

server.listen(port, host, () => {
  console.info(`SpatialDesk AI server listening on http://${host}:${port}`);
  console.info(
    assistant.configured
      ? `AI assistant: configured (model ${assistant.model})`
      : 'AI assistant: not configured (set ANTHROPIC_API_KEY to enable)',
  );
});

let shuttingDown = false;
/**
 * @param {string} reason
 * @param {number} [code]
 */
function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[server] shutting down (${reason})`);
  server.close(() => process.exit(code));
  // Drop idle keep-alive sockets so close() can finish, then hard-exit as a backstop.
  server.closeIdleConnections?.();
  setTimeout(() => {
    server.closeAllConnections?.();
    process.exit(code);
  }, 5000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal));
process.on('uncaughtException', (error) => {
  console.error('[server] uncaught exception', error);
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled rejection', reason);
});
