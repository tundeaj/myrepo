import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { ApiError } from "../lib/errors.js";
import { resolveAccess } from "../lib/access.js";
import { signPlaybackUrl, enforceConcurrency, playerSettings } from "../lib/playback.js";

/**
 * Every route here calls resolveAccess and nothing else — the same rule
 * routes/content.ts and routes/registrations.ts already follow. A player
 * endpoint is exactly the place a second, hand-rolled access check would be
 * most tempting and most dangerous: it is the thing actually guarding the
 * video bytes.
 *
 * Not mounted under requireAuth in index.ts: public content and free previews
 * play for signed-out visitors too. Each handler reads a token if one is
 * present — the same optionalUserId() pattern routes/content.ts uses — and
 * proceeds signed-out rather than 401ing outright.
 */
export const playbackRouter = Router();

function optionalUserId(req: Request): number | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifyToken(header.slice(7)).sub;
  } catch {
    return null;
  }
}

// ─── POST /playback/session ─────────────────────────────────────────────────

const SessionSchema = z.object({
  content_id: z.number().int().positive(),
  lesson_id: z.number().int().positive().optional(),
  device_type: z.enum(["desktop", "mobile", "tablet", "tv"]).optional(),
});

playbackRouter.post("/session", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SessionSchema.parse(req.body);
    const userId = optionalUserId(req);

    const content = await prisma.contentItem.findUnique({
      where: { id: body.content_id },
      select: { id: true, content_type: true, free_preview_seconds: true, has_chapters: true, has_transcript: true },
    });
    if (!content) throw new ApiError(404, "That content isn't available.");

    const access = await resolveAccess(userId, content.id);
    const previewOnly = !access.can_view;
    if (previewOnly && access.preview_seconds <= 0) {
      // No preview and no access: nothing to play. Every other reason
      // (needs_signin, needs_purchase, unavailable, …) means "don't call this
      // endpoint at all" — the detail page's AccessGate is what should have
      // stopped the viewer before they got here.
      throw new ApiError(403, "You don't have access to this yet.");
    }

    // Resolve the playable asset: a lesson's own media if lesson_id was given,
    // otherwise the content's main media.
    const mediaLink = await prisma.contentMedia.findFirst({
      where: body.lesson_id
        ? { lesson_id: body.lesson_id, role: "main" }
        : { content_id: content.id, lesson_id: null, role: "main" },
      select: { media_asset_id: true },
    });
    if (!mediaLink) throw new ApiError(404, "This doesn't have a video attached yet.");

    const asset = await prisma.mediaAsset.findUnique({
      where: { id: mediaLink.media_asset_id },
      select: { id: true, hls_url: true, mp4_url: true, transcode_status: true, duration_seconds: true },
    });
    if (!asset || asset.transcode_status !== "ready") {
      throw new ApiError(409, "This video is still processing. Check back shortly.");
    }
    const rawUrl = asset.hls_url || asset.mp4_url;
    if (!rawUrl) throw new ApiError(404, "This doesn't have a playable file yet.");

    // Concurrency is a usage limit layered on TOP of an access decision, not a
    // substitute for one — checked only after resolveAccess/preview above.
    // Skipped entirely for an anonymous viewer: there is no stable identity to
    // limit, and a signed-out preview is not the thing concurrency limits
    // exist to police.
    if (userId !== null) await enforceConcurrency(userId, access.reason);

    const session = await prisma.playbackSession.create({
      data: {
        user_id: userId,
        content_id: content.id,
        lesson_id: body.lesson_id ?? null,
        device_type: body.device_type ?? null,
      },
    });

    const url = signPlaybackUrl(rawUrl, {
      user_id: userId,
      content_id: content.id,
      lesson_id: body.lesson_id ?? null,
      asset_id: asset.id,
    });

    // Resume point: the schema has no dedicated per-content progress table
    // outside courses (LessonProgress is keyed to a lesson). For a lesson,
    // that table is authoritative. For anything else — a webinar replay, a
    // standalone video — the most recent PlaybackSession's watch_seconds is
    // used instead, a deliberate reuse of the analytics table as the resume
    // signal rather than a new column added under time pressure this late in
    // the build. An anonymous viewer has no identity to resume against —
    // always starts at 0, which is correct, not a fallback for a lookup that
    // failed.
    const resumeSeconds =
      userId === null
        ? 0
        : body.lesson_id
          ? (await prisma.lessonProgress.findUnique({
              where: { user_id_lesson_id: { user_id: userId, lesson_id: body.lesson_id } },
              select: { watch_seconds: true },
            }))?.watch_seconds ?? 0
          : (await prisma.playbackSession.findFirst({
              where: { user_id: userId, content_id: content.id, lesson_id: null, id: { not: session.id } },
              orderBy: { started_at: "desc" },
              select: { watch_seconds: true },
            }))?.watch_seconds ?? 0;

    const [chapters, subtitles, settings] = await Promise.all([
      content.has_chapters
        ? prisma.chapter.findMany({
            where: { content_id: content.id },
            orderBy: { start_seconds: "asc" },
            select: { title: true, start_seconds: true, chapter_type: true, is_skippable: true },
          })
        : Promise.resolve([]),
      prisma.subtitleTrack.findMany({
        where: { content_id: content.id, vtt_url: { not: null } },
        select: { language: true, label: true, vtt_url: true, is_default: true },
      }),
      playerSettings(),
    ]);

    res.status(201).json({
      playback_session_id: session.id,
      url,
      duration_seconds: asset.duration_seconds,
      resume_seconds: resumeSeconds,
      preview_seconds: previewOnly ? access.preview_seconds : null,
      can_view_fully: access.can_view,
      chapters,
      subtitles,
      settings,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Check the request and try again."));
    next(err);
  }
});

// ─── POST /playback/:id/heartbeat ───────────────────────────────────────────

const HeartbeatSchema = z.object({
  watch_seconds: z.number().int().min(0),
  buffering_events: z.number().int().min(0).optional(),
  buffering_seconds: z.number().int().min(0).optional(),
  quality_changes: z.number().int().min(0).optional(),
  playback_speed: z.number().positive().max(4).optional(),
});

/**
 * A session is either owned (user_id set — must match the caller) or
 * anonymous (user_id null — created signed-out, no identity to check against).
 * Never reachable by a DIFFERENT signed-in user's token: an owned session with
 * a mismatched caller is treated as not found, same as truly missing.
 */
async function findOwnedSession(id: number, callerId: number | null) {
  const session = await prisma.playbackSession.findUnique({
    where: { id },
    select: { id: true, user_id: true, content_id: true, lesson_id: true, ended_at: true },
  });
  if (!session) return null;
  if (session.user_id !== null && session.user_id !== callerId) return null;
  return session;
}

playbackRouter.post("/:id/heartbeat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const body = HeartbeatSchema.parse(req.body);
    const callerId = optionalUserId(req);

    const session = await findOwnedSession(id, callerId);
    if (!session) throw new ApiError(404, "That playback session doesn't exist.");
    if (session.ended_at) return res.json({ ok: true }); // already ended; a late heartbeat is a no-op, not an error

    // content_id is nullable on the model in general, but every session this
    // router creates always sets it — defensive fallback, not an expected path.
    const completionPct =
      session.content_id != null
        ? await completionPercent(session.content_id, session.lesson_id, body.watch_seconds)
        : 0;

    await prisma.playbackSession.update({
      where: { id },
      data: {
        watch_seconds: body.watch_seconds,
        completion_pct: completionPct,
        buffering_events: body.buffering_events,
        buffering_seconds: body.buffering_seconds,
        quality_changes: body.quality_changes,
        playback_speed: body.playback_speed,
      },
    });

    // LessonProgress.user_id is not nullable — an anonymous session (no
    // owner) has nothing to write progress against, and courses are not
    // realistically public-tier content anyway.
    if (session.lesson_id && session.user_id !== null) {
      const completed = completionPct >= 95;
      await prisma.lessonProgress.upsert({
        where: { user_id_lesson_id: { user_id: session.user_id, lesson_id: session.lesson_id } },
        update: { watch_seconds: body.watch_seconds, completed, completed_at: completed ? new Date() : undefined },
        create: {
          user_id: session.user_id,
          lesson_id: session.lesson_id,
          watch_seconds: body.watch_seconds,
          completed,
          completed_at: completed ? new Date() : undefined,
        },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Check the request and try again."));
    next(err);
  }
});

// ─── POST /playback/:id/end ──────────────────────────────────────────────────

playbackRouter.post("/:id/end", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const session = await findOwnedSession(id, optionalUserId(req));
    if (!session) throw new ApiError(404, "That playback session doesn't exist.");
    if (!session.ended_at) {
      await prisma.playbackSession.update({ where: { id }, data: { ended_at: new Date() } });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Plain number, 0-100. Prisma accepts a number directly for a Decimal
 *  column — no need to construct one by hand. */
async function completionPercent(contentId: number, lessonId: number | null, watchSeconds: number): Promise<number> {
  const mediaLink = await prisma.contentMedia.findFirst({
    where: lessonId ? { lesson_id: lessonId, role: "main" } : { content_id: contentId, lesson_id: null, role: "main" },
    select: { media_asset_id: true },
  });
  if (!mediaLink) return 0;

  const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaLink.media_asset_id }, select: { duration_seconds: true } });
  const totalSeconds = asset?.duration_seconds;
  if (!totalSeconds || totalSeconds <= 0) return 0;

  return Math.min(100, Math.round((watchSeconds / totalSeconds) * 10000) / 100);
}
