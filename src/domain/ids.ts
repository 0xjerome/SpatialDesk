/** Generate a unique record id, using the platform UUID when available. */
export function createId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Fallback for very old runtimes: timestamp plus random suffix.
  const rand = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
