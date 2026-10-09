import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { publicSettings, publicStrings } from "../lib/homepageCache.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Simple static pages — About, Terms, Privacy, and one-off marketing
 * landing pages. `/admin/pages` and `/admin/landing-pages` were both
 * PlaceholderPages with no schema behind either ("a future CMS prompt").
 * Scoped deliberately narrow, confirmed with the user before building: a
 * flat title + rich HTML body + SEO fields + published toggle, not a
 * visual block builder. One model backs both nav entries — the same "one
 * admin page, two routes" convention Category already uses for
 * /admin/categories and /admin/sessions/categories — the admin UI is the
 * same editor regardless of which nav item got there.
 *
 * Two routers, same split as faqs.ts: `pagesRouter` is the admin CRUD
 * surface (mounted with requireAuth + requireAdmin, sees every page
 * regardless of publish state); `publicPagesRouter` is what a visitor's
 * browser calls (mounted with no auth, only ever returns is_published
 * rows), reached at /p/:slug.
 */
export const pagesRouter = Router();
export const publicPagesRouter = Router();

const PAGE_SELECT = {
  id: true,
  title: true,
  title_fr: true,
  slug: true,
  body_html: true,
  body_html_fr: true,
  seo_title: true,
  seo_meta_description: true,
  is_published: true,
  created_at: true,
  updated_at: true,
} as const;

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 150);
}

// ─── Admin CRUD ─────────────────────────────────────────────────────────────

// GET /pages — every page, published or not.
pagesRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const pages = await prisma.page.findMany({ orderBy: { updated_at: "desc" }, select: PAGE_SELECT });
    res.json({ pages });
  } catch (err) {
    next(err);
  }
});

const FieldsSchema = z.object({
  title: z.string().trim().min(1, "A title is required.").max(200),
  title_fr: z.string().trim().max(200).nullable().optional(),
  body_html: z.string().trim().min(1, "A body is required.").max(50000),
  body_html_fr: z.string().trim().max(50000).nullable().optional(),
  seo_title: z.string().trim().max(200).nullable().optional(),
  seo_meta_description: z.string().trim().max(300).nullable().optional(),
  is_published: z.boolean().default(false),
});

// POST /pages — the slug is derived from the title at creation and never
// changes on rename, same rule Category's own slug already follows:
// whatever /p/:slug link anyone has shared or bookmarked keeps working.
pagesRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = FieldsSchema.parse(req.body);
    const slug = slugify(body.title);
    const existingSlug = await prisma.page.findFirst({ where: { slug }, select: { id: true } });
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    const page = await prisma.page.create({
      data: {
        title: body.title,
        title_fr: body.title_fr ?? null,
        slug: finalSlug,
        body_html: body.body_html,
        body_html_fr: body.body_html_fr ?? null,
        seo_title: body.seo_title ?? null,
        seo_meta_description: body.seo_meta_description ?? null,
        is_published: body.is_published,
      },
      select: PAGE_SELECT,
    });
    res.status(201).json({ page });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /pages/:id
pagesRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid page id");
    const existing = await prisma.page.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Page not found");

    const body = FieldsSchema.parse(req.body);
    const page = await prisma.page.update({
      where: { id },
      data: {
        title: body.title,
        title_fr: body.title_fr ?? null,
        body_html: body.body_html,
        body_html_fr: body.body_html_fr ?? null,
        seo_title: body.seo_title ?? null,
        seo_meta_description: body.seo_meta_description ?? null,
        is_published: body.is_published,
      },
      select: PAGE_SELECT,
    });
    res.json({ page });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /pages/:id — nothing else in the schema references a page, so
// this is a real delete, same call Promotions and FAQs already make for
// the same reason.
pagesRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid page id");
    const existing = await prisma.page.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Page not found");
    await prisma.page.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Public read path ───────────────────────────────────────────────────────

// GET /public-pages/:slug — only ever a published page. An unpublished or
// nonexistent slug both 404 identically, so a visitor (or a crawler) can
// never distinguish "doesn't exist" from "not published yet."
publicPagesRouter.get("/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [page, settings, strings] = await Promise.all([
      prisma.page.findFirst({
        where: { slug: req.params.slug, is_published: true },
        select: {
          title: true,
          title_fr: true,
          slug: true,
          body_html: true,
          body_html_fr: true,
          seo_title: true,
          seo_meta_description: true,
        },
      }),
      publicSettings(),
      publicStrings(),
    ]);
    if (!page) throw new ApiError(404, "Page not found");
    // settings/strings alongside the page itself, same PublicBootstrap
    // contract every other standalone public page (Faqs, Contact, ...)
    // already follows — a deep link to /p/:slug paints on one request.
    res.json({ page, settings, strings });
  } catch (err) {
    next(err);
  }
});
