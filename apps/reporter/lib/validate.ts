/** Input guards shared by actions and routes. */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_MESSAGE_CHARS = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

export function assertUuid(v: unknown, what: string): asserts v is string {
  if (!isUuid(v)) throw new Error(`Invalid ${what} id.`);
}

/**
 * Fixed-window rate limiter, per key, in process memory. Enough to stop a
 * runaway client from burning the model budget; a multi-instance deployment
 * would move this to Redis or the edge.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { ok: true, retryAfterSec: 0 }; }
  b.count++;
  if (b.count > limit) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}
