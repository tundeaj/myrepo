import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { resolveAccess } from "../lib/access.js";
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
 */
export const ratingsRouter = Router();

const RateSchema = z.object({
  content_id: z.number().int().positive(),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).trim().nullable().optional(),
});

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

    const rating = await prisma.rating.upsert({
      where: { user_id_content_id: { user_id: userId, content_id: body.content_id } },
      create: { user_id: userId, content_id: body.content_id, score: body.score, comment: body.comment ?? null },
      update: { score: body.score, comment: body.comment ?? null },
    });

    const aggregate = await recomputeAggregate(body.content_id);
    res.status(201).json({ rating, ...aggregate });
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
