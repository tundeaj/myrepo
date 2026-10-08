import { Redis } from "ioredis";
import { env } from "./env.js";

/**
 * One shared connection, reused by the rate limiter and the job scheduler —
 * the same infra decision backs both (see env.ts's REDIS_URL comment).
 * BullMQ requires maxRetriesPerRequest: null on any connection it's handed;
 * this client is also used directly by the rate limiter, so that setting
 * lives here once rather than being repeated at every call site.
 */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

redis.on("error", (err: Error) => {
  console.error("[redis] connection error:", err.message);
});
