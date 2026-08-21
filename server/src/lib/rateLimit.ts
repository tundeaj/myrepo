// Fixed-window per-user rate limiter, in process memory.
//
// This is deliberately simple: a single API instance is the deployment shape
// here, and the limit exists to stop one admin burning the AI budget in a loop,
// not to defend against a distributed attacker. On a multi-instance deploy this
// needs to move to Redis — the interface below won't change.

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Sweep expired windows hourly so an idle process doesn't hold every key it has
// ever seen. unref() so this timer never keeps the process alive on shutdown.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}, 3600_000);
sweeper.unref?.();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — the value for the Retry-After header. */
  retryAfter: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfter: 0 };
}

/** PROMPT 10: 20 AI suggestion calls per user per hour. */
export const AI_SUGGEST_LIMIT = 20;
export const AI_SUGGEST_WINDOW_MS = 3600_000;
