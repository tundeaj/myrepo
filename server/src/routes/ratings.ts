import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { resolveAccess } from "../lib/access.js";
import { getSetting } from "../lib/settingValue.js";
import { sendMail, publicUrl } from "../lib/mail.js";
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

const ModerateSchema = z
  .object({
    // Optional — translating a comment_fr is a separate concern from
    // approving/rejecting it (see below), so a caller that only wants to
    // save a translation on a still-pending comment can omit status
    // entirely rather than being forced to pick approved/rejected for it.
    status: z.enum(["approved", "rejected"]).optional(),
    // Single-item only — a bulk batch has nowhere to collect per-row
    // translated text, so comment_fr is never part of the /bulk schema below.
    comment_fr: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.comment_fr !== undefined, {
    message: "Provide a status, a comment_fr, or both.",
  });

/**
 * The actual moderation write, shared by the single-item PUT /:id below and
 * POST /bulk — one place for the comment_status transition, the "only email
 * on a real transition" rule, and the sendMail call, so the two never drift.
 * Throws ApiError for the single-item route to surface directly; /bulk
 * instead catches it per id so one bad id in a batch can't sink the rest.
 */
async function findCommentedRating(id: number) {
  const existing = await prisma.rating.findFirst({ where: { id } });
  if (!existing) throw new ApiError(404, "Rating not found");
  if (!existing.comment) throw new ApiError(422, "This rating has no comment to moderate.");
  return existing;
}

async function moderateOne(id: number, status: "approved" | "rejected") {
  const existing = await findCommentedRating(id);

  const rating = await prisma.rating.update({ where: { id }, data: { comment_status: status } });

  // Notify the reviewer, same sendMail/publicUrl pattern every other
  // transactional email in this codebase already uses. Only on a real
  // transition — re-approving an already-approved comment (a double click,
  // or two admins racing on the same queue row) shouldn't re-send. sendMail
  // never throws (it logs and returns false on failure), so this never
  // risks the moderation decision itself, same guarantee every other
  // sendMail call site in this file relies on.
  if (existing.comment_status !== status) {
    const [user, content] = await Promise.all([
      prisma.user.findUnique({ where: { id: existing.user_id }, select: { email: true } }),
      prisma.contentItem.findUnique({ where: { id: existing.content_id }, select: { title: true, slug: true } }),
    ]);
    if (user?.email && content) {
      const approved = status === "approved";
      await sendMail({
        to: user.email,
        subject: approved
          ? `Your review of ${content.title} is now live`
          : `Your review of ${content.title} wasn't approved`,
        lines: approved
          ? [`The comment on your rating of ${content.title} has been approved and is now visible to other viewers.`]
          : [
              `The comment on your rating of ${content.title} wasn't approved for public display.`,
              "Your star rating itself is unaffected and still counts toward the item's average.",
            ],
        action: approved ? { label: "View it", url: publicUrl(`/watch/${content.slug}`) } : undefined,
      });
    }
  }

  return rating;
}

const BulkModerateSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "At least one id is required.").max(100, "At most 100 at a time."),
  status: z.enum(["approved", "rejected"]),
});

// POST /ratings-moderation/bulk — approve or reject several comments in one
// request, the same decision a human would otherwise click through one row
// at a time from the moderation queue. Registered ahead of PUT /:id so the
// literal path "bulk" is never swallowed by that route's :id param.
//
// Partial failure is expected, not exceptional: by the time a selection an
// admin made seconds ago reaches the server, another admin (or this same
// one, in another tab) may have already moderated or deleted one of the
// rows. One bad id degrades that row, not the batch — every other id in the
// request still gets its own real decision and, where applicable, its own
// notification.
ratingsModerationRouter.post("/bulk", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = BulkModerateSchema.parse(req.body);
    const uniqueIds = [...new Set(body.ids)];

    const ratings: unknown[] = [];
    const failed: { id: number; error: string }[] = [];
    for (const id of uniqueIds) {
      try {
        ratings.push(await moderateOne(id, body.status));
      } catch (err) {
        failed.push({ id, error: err instanceof ApiError ? err.message : "Failed to moderate." });
      }
    }

    res.json({ ratings, failed });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /ratings-moderation/:id — approve or reject one comment. The rating's
// score and its contribution to the aggregate are completely unaffected —
// this only ever governs whether the COMMENT text is shown, never whether
// the score counts.
ratingsModerationRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid rating id");
    const body = ModerateSchema.parse(req.body);

    // status is optional — a caller saving only a translation on a still-
    // pending comment has nothing to transition, so it just confirms the
    // row is real and commented, the same guard moderateOne itself applies.
    let rating = body.status !== undefined ? await moderateOne(id, body.status) : await findCommentedRating(id);

    // comment_fr: an admin-authored French translation, same shape as every
    // other _fr field in this schema (title_fr, answer_html_fr, ...) — the
    // viewer's own comment is never touched. Written separately from the
    // status transition above: translating is optional and orthogonal to
    // the approve/reject decision, so this never blocks or complicates it.
    if (body.comment_fr !== undefined) {
      rating = await prisma.rating.update({
        where: { id },
        data: { comment_fr: body.comment_fr?.trim() || null },
      });
    }

    res.json({ rating });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
