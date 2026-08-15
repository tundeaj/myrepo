import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { resolveAccess } from "../lib/access.js";
import { getSetting } from "../lib/settingValue.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Viewer ratings. The `ratings` table existed from Prompt 01-C — its unique
 * (user_id, content_id) pair is exactly right for "one rating per viewer per
 * item" — but nothing ever wrote to it. routes/instructors.ts already reads
 * it (an instructor's average across their content), and
 * ContentItem.avg_rating/rating_count are already in the public detail
 * payload — both sides of this were waiting for a write path that never
 * existed. This is that path.
 *
 * Gated on resolveAccess(...).can_view, not on "did they finish watching" —
 * this app has no watched-to-completion signal reliable enough to gate on
 * (LessonProgress exists for course lessons only; standalone webinar replays
 * have nothing comparable). Access is the bar this codebase already applies
 * everywhere else a viewer-only action needs a check.
 *
 * A rating's optional written `comment` is a separate story: whether one is
 * ever shown publicly, and whether it needs approval first, is a real
 * product policy decision — not something to hardcode a guess for. That
 * decision is exposed as an admin-configurable setting
 * (content_policy.rating_comments_mode, see settingsSchema.ts) rather than
 * decided here: 'hidden' (default — comments are stored but never surfaced
 * anywhere), 'auto_publish' (shown immediately), or 'review_required' (held
 * 'pending' until an admin approves or rejects it via ratingsModerationRouter
 * below). Defaulting to 'hidden' means this migration changes nothing about
 * what the public site shows until an admin actively opts in.
 */
export const ratingsRouter = Router();
export const ratingsModerationRouter = Router();

const RateSchema = z.object({
  content_id: z.number().int().positive(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).trim().nullable().optional(),
});

type CommentMode = "hidden" | "auto_publish" | "review_required";

async function commentMode(): Promise<CommentMode> {
  const value = await getSetting("content_policy.rating_comments_mode");
  return value === "auto_publish" || value === "review_required" ? value : "hidden";
}

async function recomputeAggregate(contentId: number) {
  const agg = await prisma.rating.aggregate({
    where: { content_id: contentId },
    _avg: { score: true },
    _count: { score: true },
  });
  const avg = agg._avg.score != null ? Math.round(agg._avg.score * 100) / 100 : 0;
  await prisma.contentItem.update({
    where: { id: contentId },
    data: { avg_rating: avg, rating_count: agg._count.score },
  });
  return { avg_rating: avg, rating_count: agg._count.score };
}

// POST /ratings — create or update the caller's own rating for one item
ratingsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RateSchema.parse(req.body);
    const userId = req.user!.sub;

    const content = await prisma.contentItem.findUnique({ where: { id: body.content_id }, select: { id: true } });
    if (!content) throw new ApiError(404, "That item isn't available.");

    const access = await resolveAccess(userId, body.content_id);
    if (!access.can_view) throw new ApiError(403, "You need access to this to rate it.");

    // Re-derived on every write, not preserved across edits: a comment that
    // changed needs fresh review under 'review_required', the same way a
    // FAQ edit doesn't inherit stale state — except here the state SHOULD
    // reset, because the content that would be published actually changed.
    const mode = await commentMode();
    const commentStatus = mode === "auto_publish" ? "approved" : "pending";

    const rating = await prisma.rating.upsert({
      where: { user_id_content_id: { user_id: userId, content_id: body.content_id } },
      create: { user_id: userId, content_id: body.content_id, score: body.score, comment: body.comment ?? null, comment_status: commentStatus },
      update: { score: body.score, comment: body.comment ?? null, comment_status: commentStatus },
    });

    const aggregate = await recomputeAggregate(body.content_id);
    res.status(201).json({ rating, comment_mode: mode, ...aggregate });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// GET /ratings/mine?content_id= — the caller's own rating, so the UI can
// prefill "you rated this" instead of always showing an empty picker.
ratingsRouter.get("/mine", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contentId = Number(req.query.content_id);
    if (!contentId) throw new ApiError(400, "content_id is required.");
    const userId = req.user!.sub;

    const rating = await prisma.rating.findUnique({
      where: { user_id_content_id: { user_id: userId, content_id: contentId } },
    });
    res.json({ rating: rating ?? null });
  } catch (err) {
    next(err);
  }
});

// DELETE /ratings/:content_id — withdraw the caller's own rating
ratingsRouter.delete("/:content_id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contentId = Number(req.params.content_id);
    if (!contentId) throw new ApiError(400, "Invalid content id");
    const userId = req.user!.sub;

    const existing = await prisma.rating.findUnique({ where: { user_id_content_id: { user_id: userId, content_id: contentId } } });
    if (!existing) throw new ApiError(404, "You haven't rated this.");

    await prisma.rating.delete({ where: { id: existing.id } });
    const aggregate = await recomputeAggregate(contentId);
    res.json({ ok: true, ...aggregate });
  } catch (err) {
    next(err);
  }
});

// ─── Admin moderation queue ─────────────────────────────────────────────────
// Only ever relevant under 'review_required' — under 'hidden' or
// 'auto_publish' there's nothing here that needs a human decision. Mounted
// separately (requireAuth + requireAdmin) from ratingsRouter above, which
// any signed-in viewer can call.

const MODERATION_STATUSES = ["pending", "approved", "rejected"] as const;

// GET /ratings-moderation — every rating with a real (non-empty) comment,
// optionally filtered by status; defaults to the queue an admin actually
// wants to see first.
ratingsModerationRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "pending";
    if (!MODERATION_STATUSES.includes(status as (typeof MODERATION_STATUSES)[number])) {
      throw new ApiError(400, "Invalid status filter.");
    }

    const ratings = await prisma.rating.findMany({
      where: { comment: { not: null }, comment_status: status as (typeof MODERATION_STATUSES)[number] },
      orderBy: { id: "desc" },
    });

    const userIds = [...new Set(ratings.map((r) => r.user_id))];
    const contentIds = [...new Set(ratings.map((r) => r.content_id))];
    const [users, content] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, full_name: true, email: true } }),
      prisma.contentItem.findMany({ where: { id: { in: contentIds } }, select: { id: true, title: true, slug: true } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const contentById = new Map(content.map((c) => [c.id, c]));

    res.json({
      ratings: ratings.map((r) => ({
        ...r,
        reviewer: userById.get(r.user_id)?.full_name ?? userById.get(r.user_id)?.email ?? `User #${r.user_id}`,
        content_title: contentById.get(r.content_id)?.title ?? `Content #${r.content_id}`,
        content_slug: contentById.get(r.content_id)?.slug ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const ModerateSchema = z.object({ status: z.enum(["approved", "rejected"]) });

// PUT /ratings-moderation/:id — approve or reject one comment. The rating's
// score and its contribution to the aggregate are completely unaffected —
// this only ever governs whether the COMMENT text is shown, never whether
// the score counts.
ratingsModerationRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid rating id");
    const existing = await prisma.rating.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Rating not found");
    if (!existing.comment) throw new ApiError(422, "This rating has no comment to moderate.");

    const body = ModerateSchema.parse(req.body);
    const rating = await prisma.rating.update({ where: { id }, data: { comment_status: body.status } });
    res.json({ rating });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
