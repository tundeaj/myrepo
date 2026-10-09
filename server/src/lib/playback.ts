import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { env } from "./env.js";
import { ApiError } from "./errors.js";
import { getSetting, getNumberSetting, getBoolSetting } from "./settingValue.js";

/**
 * "No DRM: signed URLs + concurrency limits + email watermark covers every
 * realistic threat." This module is the first two of those three.
 *
 * ⚠️ Scope, stated plainly: this signs the top-level manifest/file URL — the
 * one resolveAccess has already approved — with a short-lived, viewer-bound
 * token. It does not proxy or re-sign individual HLS segment requests. Making
 * the CDN edge actually *enforce* that token against each segment (Bunny
 * Token Authentication, CloudFront signed cookies, whichever `stream_provider`
 * is configured) is a deployment-time configuration matching the real
 * hosting provider, not application code — the same division of labour as
 * Prompt 09's ImageKit URLs, where this app builds the parameterized URL and
 * the provider's own pipeline is what applies it.
 */

export interface PlaybackTokenPayload {
  /** Distinguishes this from an auth token structurally, not just by name —
   *  an auth token must never be accepted here, and vice versa. */
  purpose: "playback";
  user_id: number | null;
  content_id: number;
  lesson_id: number | null;
  asset_id: number;
}

const PLAYBACK_TOKEN_TTL_HOURS = 6;

export function signPlaybackUrl(rawUrl: string, payload: Omit<PlaybackTokenPayload, "purpose">): string {
  const token = jwt.sign({ ...payload, purpose: "playback" }, env.JWT_SECRET, {
    expiresIn: `${PLAYBACK_TOKEN_TTL_HOURS}h`,
  });
  const url = new URL(rawUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

/** Not currently called anywhere — the CDN edge would call the equivalent of
 *  this if it were configured to validate the token itself. Kept here as the
 *  documented shape of what a token contains, and usable from a future
 *  edge-auth webhook without re-deriving the payload shape. */
export function verifyPlaybackToken(token: string): PlaybackTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as unknown as PlaybackTokenPayload;
  if (decoded.purpose !== "playback") throw new Error("Not a playback token.");
  return decoded;
}

// ─── Concurrency ────────────────────────────────────────────────────────────
//
// "Active" means ended_at IS NULL. A crashed tab that never called
// POST /playback/end would otherwise lock a viewer out of their own account
// forever, so a session older than the staleness window stops counting
// against the limit even without an explicit end — abandoned, not held open.

const STALE_SESSION_HOURS = 6;

/** Single-stream is the sane default for anything that isn't a multi-device
 *  subscription plan: one purchase, one cohort seat, one free registration —
 *  each is one viewer, not explicitly a multi-device household. */
const DEFAULT_CONCURRENCY_LIMIT = 1;

export async function concurrencyLimitFor(userId: number, accessReason: string): Promise<number> {
  if (accessReason !== "subscribed") return DEFAULT_CONCURRENCY_LIMIT;

  const subscription = await prisma.subscription.findFirst({
    where: { user_id: userId, status: { in: ["active", "past_due", "paused"] } },
    orderBy: { created_at: "desc" },
    select: { plan_id: true },
  });
  if (!subscription) return DEFAULT_CONCURRENCY_LIMIT;

  const plan = await prisma.plan.findUnique({
    where: { id: subscription.plan_id },
    select: { max_concurrent_streams: true },
  });
  return plan?.max_concurrent_streams ?? DEFAULT_CONCURRENCY_LIMIT;
}

/** Throws 409 if starting a new stream would exceed the viewer's limit.
 *  Call this AFTER resolveAccess has already granted access — concurrency is
 *  a usage limit on top of an access decision, not a substitute for one. */
export async function enforceConcurrency(userId: number, accessReason: string): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_SESSION_HOURS * 3600_000);
  const [activeCount, limit] = await Promise.all([
    prisma.playbackSession.count({
      where: { user_id: userId, ended_at: null, started_at: { gt: staleCutoff } },
    }),
    concurrencyLimitFor(userId, accessReason),
  ]);

  if (activeCount >= limit) {
    throw new ApiError(
      409,
      limit === 1
        ? "You're already watching on another device. Stop playback there to continue here."
        : `You've reached your limit of ${limit} devices watching at once.`,
    );
  }
}

// ─── Settings the player needs at load time ────────────────────────────────

export async function playerSettings() {
  // Read as a group, feeding a single response rather than six round trips.
  const [speeds, subtitlesDefaultOn, dataSaverAvailable, autoplayDesktop, autoplayMobile, watermarkEnabled, watermarkOpacity, skipChapter] =
    await Promise.all([
      getSetting("playback.playback_speeds"),
      getBoolSetting("playback.subtitles_default_on", true),
      getBoolSetting("playback.data_saver_available", true),
      getBoolSetting("playback.autoplay_desktop", true),
      getBoolSetting("playback.autoplay_mobile", false),
      getBoolSetting("playback.watermark_enabled", false),
      getNumberSetting("playback.watermark_opacity", 30),
      getBoolSetting("playback.skip_chapter", true),
    ]);

  return {
    playback_speeds: speeds.split(",").map((s) => s.trim()).filter(Boolean),
    subtitles_default_on: subtitlesDefaultOn,
    data_saver_available: dataSaverAvailable,
    autoplay_desktop: autoplayDesktop,
    autoplay_mobile: autoplayMobile,
    watermark_enabled: watermarkEnabled,
    watermark_opacity: watermarkOpacity,
    skip_chapter: skipChapter,
  };
}
