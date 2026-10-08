import { redis } from "./redis.js";

// Fixed-window rate limiter, Redis-backed — moved off in-process memory now
// that a real job queue (lib/scheduler.ts) needs Redis anyway, which was the
// one thing this file's own previous comment said would force the move: "On
// a multi-instance deploy this needs to move to Redis — the interface below
// won't change." It hasn't: checkRateLimit()'s signature and RateLimitResult
// shape are exactly as before, just async now, so every call site only
// needed an `await` added, nothing else.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets — the value for the Retry-After header. */
  retryAfter: number;
}

// INCR-then-PEXPIRE-if-first, read back via PTTL, all inside one Lua script
// so the whole thing is atomic under Redis's single-threaded script
// execution — no separate round trip can race another request's and leave a
// key with a wrong expiry or a lost increment. A key's counter keeps
// climbing on repeated requests made after the limit is already hit (it only
// ever gets INCR'd, never read-then-conditionally-written), but that's
// invisible here: `allowed`/`remaining` are derived from `limit`, and
// `retryAfter` from the real PTTL, so the response is identical either way —
// it just avoids a read-modify-write race for a property this code never
// actually needs (the exact over-limit count).
const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if tonumber(current) == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
return {current, ttl}
`;

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const [count, ttlMs] = (await redis.eval(RATE_LIMIT_SCRIPT, 1, redisKey, windowMs)) as [number, number];

  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);
  // A negative/missing TTL (PERSIST'd or lost key) shouldn't ever happen
  // given the script above always PEXPIREs a fresh key, but falls back to
  // the full window rather than a bogus Retry-After if it somehow does.
  const retryAfter = allowed ? 0 : Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000));

  return { allowed, remaining, retryAfter };
}

/** PROMPT 10: 20 AI suggestion calls per user per hour. */
export const AI_SUGGEST_LIMIT = 20;
export const AI_SUGGEST_WINDOW_MS = 3600_000;
