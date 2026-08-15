import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
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

// POST /public-faqs/:id/helpful — { helpful: true|false }. No per-user
// dedup: the schema carries no user/session identifier on this table (no
// unique constraint the way Rating has on user_id+content_id), so this is
// honestly a one-vote-per-click counter, not a one-vote-per-visitor one —
// stated as a real, bounded limitation rather than faked with a client-side
// localStorage flag that would give a false impression of real deduping.
publicFaqsRouter.post("/:id/helpful", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid FAQ id");
    const body = HelpfulSchema.parse(req.body);
    const existing = await prisma.faq.findFirst({ where: { id, is_published: true } });
    if (!existing) throw new ApiError(404, "FAQ not found");
    const updated = await prisma.faq.update({
      where: { id },
      data: body.helpful ? { helpful_yes: { increment: 1 } } : { helpful_no: { increment: 1 } },
      select: { helpful_yes: true, helpful_no: true },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
