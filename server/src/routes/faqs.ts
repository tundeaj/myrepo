import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { verifyToken } from "../lib/jwt.js";
import { publicSettings, publicStrings } from "../lib/homepageCache.js";
import type { Request, Response, NextFunction } from "express";

/**
 * The `faqs` table (question/answer, scope global-or-content, category,
 * display_order, is_published, plus views/helpful_yes/helpful_no counters)
 * has existed since the original schema — `/admin/faqs` has been a
 * PlaceholderPage the whole time, and nothing on the public side ever read
 * it either. Both a write path and a read path were missing; this builds
 * both, same shape as Ratings and the Payouts transfer webhook earlier in
 * this gap sweep.
 *
 * Two routers, same split as checkout.ts / content.ts: `faqsRouter` is the
 * admin CRUD surface (mounted with requireAuth + requireAdmin, sees every
 * FAQ regardless of publish state); `publicFaqsRouter` is what a visitor's
 * browser actually calls (mounted with no auth, only ever returns
 * is_published rows).
 */
export const faqsRouter = Router();
export const publicFaqsRouter = Router();

const FaqSchema = z
  .object({
    question: z.string().trim().min(1, "A question is required.").max(300),
    question_fr: z.string().trim().max(300).nullable().optional(),
    answer_html: z.string().trim().min(1, "An answer is required.").max(20000),
    answer_html_fr: z.string().trim().max(20000).nullable().optional(),
    scope: z.enum(["global", "content"]),
    content_id: z.number().int().positive().nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    display_order: z.number().int().nullable().optional(),
    is_published: z.boolean().default(false),
  })
  .refine((b) => b.scope !== "content" || b.content_id != null, {
    message: "Pick which content item this FAQ belongs to, or switch scope to \"Global\".",
    path: ["content_id"],
  });

// ─── Admin CRUD ─────────────────────────────────────────────────────────────

// GET /faqs — every FAQ, published or not, newest scope groups first.
faqsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const faqs = await prisma.faq.findMany({ orderBy: [{ scope: "asc" }, { display_order: "asc" }, { id: "asc" }] });
    res.json({ faqs });
  } catch (err) {
    next(err);
  }
});

// GET /faqs/:id
faqsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid FAQ id");
    const faq = await prisma.faq.findFirst({ where: { id } });
    if (!faq) throw new ApiError(404, "FAQ not found");
    res.json({ faq });
  } catch (err) {
    next(err);
  }
});

// POST /faqs — create
faqsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = FaqSchema.parse(req.body);
    if (body.scope === "content") {
      const content = await prisma.contentItem.findUnique({ where: { id: body.content_id! }, select: { id: true } });
      if (!content) throw new ApiError(404, "That content item doesn't exist.");
    }

    const faq = await prisma.faq.create({
      data: {
        question: body.question,
        question_fr: body.question_fr ?? null,
        answer_html: body.answer_html,
        answer_html_fr: body.answer_html_fr ?? null,
        scope: body.scope,
        content_id: body.scope === "content" ? body.content_id : null,
        category: body.category ?? null,
        display_order: body.display_order ?? null,
        is_published: body.is_published,
      },
    });
    res.status(201).json({ faq });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /faqs/:id — update. Deliberately does not touch views/helpful_yes/
// helpful_no — those are counters the public routes below own exclusively,
// and an admin edit shouldn't reset feedback that's already been collected.
faqsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid FAQ id");
    const existing = await prisma.faq.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "FAQ not found");

    const body = FaqSchema.parse(req.body);
    if (body.scope === "content") {
      const content = await prisma.contentItem.findUnique({ where: { id: body.content_id! }, select: { id: true } });
      if (!content) throw new ApiError(404, "That content item doesn't exist.");
    }

    const faq = await prisma.faq.update({
      where: { id },
      data: {
        question: body.question,
        question_fr: body.question_fr ?? null,
        answer_html: body.answer_html,
        answer_html_fr: body.answer_html_fr ?? null,
        scope: body.scope,
        content_id: body.scope === "content" ? body.content_id : null,
        category: body.category ?? null,
        display_order: body.display_order ?? null,
        is_published: body.is_published,
      },
    });
    res.json({ faq });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /faqs/:id — no redemption-style history to protect (unlike
// Coupons/PayoutLine), so this deletes outright.
faqsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid FAQ id");
    const existing = await prisma.faq.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "FAQ not found");
    await prisma.faq.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Mirrors content.ts's / playback.ts's own local optionalUserId — this
// endpoint is unauthenticated (no requireAuth), but a caller MAY carry a
// valid token, and a signed-in vote is the one case this route can actually
// dedupe. Same "no shared helper" convention those two files already use.
function optionalUserId(req: Request): number | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifyToken(header.slice(7)).sub;
  } catch {
    return null;
  }
}

// ─── Public read path ───────────────────────────────────────────────────────

// GET /public-faqs — global FAQs (no content_id) or a single content item's
// FAQs (content_id given). Either way, only ever is_published rows — an
// admin previewing a draft FAQ uses the admin list above, not this one.
//
// The global (no content_id) call doubles as the standalone /faqs page's
// sole bootstrap request — same "settings + strings ship with the page's
// own data" convention every other public page follows (see
// public/lib/publicPage.tsx's usePublicData) — so it also carries the site
// settings/translation strings the page shell needs to paint nav and
// footer. The content-scoped call is an embedded widget on a page that
// already has its own bootstrap (Detail.tsx), so it skips that extra work.
publicFaqsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contentId = req.query.content_id ? Number(req.query.content_id) : null;
    if (req.query.content_id && !contentId) throw new ApiError(400, "Invalid content_id");

    const [faqs, settings, strings] = await Promise.all([
      prisma.faq.findMany({
        where: contentId
          ? { scope: "content", content_id: contentId, is_published: true }
          : { scope: "global", is_published: true },
        orderBy: [{ display_order: "asc" }, { id: "asc" }],
        select: {
          id: true,
          question: true,
          answer_html: true,
          category: true,
          display_order: true,
          views: true,
          helpful_yes: true,
          helpful_no: true,
        },
      }),
      contentId ? Promise.resolve({}) : publicSettings(),
      contentId ? Promise.resolve({}) : publicStrings(),
    ]);
    res.json({ faqs, settings, strings });
  } catch (err) {
    next(err);
  }
});

// POST /public-faqs/:id/view — fire-and-forget from the client the moment a
// visitor actually expands a question. Only a published FAQ can be "viewed"
// this way; an unpublished id 404s rather than quietly counting a view
// nobody outside the admin console could have actually seen.
publicFaqsRouter.post("/:id/view", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid FAQ id");
    const existing = await prisma.faq.findFirst({ where: { id, is_published: true } });
    if (!existing) throw new ApiError(404, "FAQ not found");
    const updated = await prisma.faq.update({ where: { id }, data: { views: { increment: 1 } }, select: { views: true } });
    res.json({ views: updated.views });
  } catch (err) {
    next(err);
  }
});

const HelpfulSchema = z.object({ helpful: z.boolean() });

// POST /public-faqs/:id/helpful — { helpful: true|false }.
//
// Deduped for a signed-in viewer via faq_votes' (faq_id, user_id) unique
// constraint: a first vote counts, a repeat click of the SAME choice is a
// no-op (not a second increment), and switching yes<->no moves the count —
// decrement the old bucket, increment the new one, in one transaction —
// rather than double-counting. An anonymous visitor carries no stable
// identity anywhere in this codebase (no anon-id cookie mechanism exists);
// faking a dedup for them with a client-side-only flag would give a false
// impression of a control nobody can actually enforce server-side, so for
// them this stays the same honest one-vote-per-click counter as before this
// round. The response's `deduped`/`changed` fields tell the client which
// case it landed in, so the UI can be honest about it too.
publicFaqsRouter.post("/:id/helpful", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid FAQ id");
    const body = HelpfulSchema.parse(req.body);
    const existing = await prisma.faq.findFirst({ where: { id, is_published: true } });
    if (!existing) throw new ApiError(404, "FAQ not found");

    const userId = optionalUserId(req);
    if (userId == null) {
      const updated = await prisma.faq.update({
        where: { id },
        data: body.helpful ? { helpful_yes: { increment: 1 } } : { helpful_no: { increment: 1 } },
        select: { helpful_yes: true, helpful_no: true },
      });
      return res.json({ ...updated, deduped: false, changed: true });
    }

    const priorVote = await prisma.faqVote.findUnique({
      where: { faq_id_user_id: { faq_id: id, user_id: userId } },
    });

    if (!priorVote) {
      const [updated] = await prisma.$transaction([
        prisma.faq.update({
          where: { id },
          data: body.helpful ? { helpful_yes: { increment: 1 } } : { helpful_no: { increment: 1 } },
          select: { helpful_yes: true, helpful_no: true },
        }),
        prisma.faqVote.create({ data: { faq_id: id, user_id: userId, helpful: body.helpful } }),
      ]);
      return res.json({ ...updated, deduped: true, changed: true });
    }

    if (priorVote.helpful === body.helpful) {
      const current = await prisma.faq.findUniqueOrThrow({ where: { id }, select: { helpful_yes: true, helpful_no: true } });
      return res.json({ ...current, deduped: true, changed: false });
    }

    // A flip: the bucket being decremented is guaranteed >= 1 here — this
    // exact prior vote is what incremented it in the first place, and
    // nothing else in this codebase ever decrements helpful_yes/helpful_no.
    const [updated] = await prisma.$transaction([
      prisma.faq.update({
        where: { id },
        data: body.helpful
          ? { helpful_yes: { increment: 1 }, helpful_no: { decrement: 1 } }
          : { helpful_no: { increment: 1 }, helpful_yes: { decrement: 1 } },
        select: { helpful_yes: true, helpful_no: true },
      }),
      prisma.faqVote.update({ where: { faq_id_user_id: { faq_id: id, user_id: userId } }, data: { helpful: body.helpful } }),
    ]);
    res.json({ ...updated, deduped: true, changed: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
