import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Categories. GET (active-only) and POST (quick-create) have existed since
 * an early prompt — ClassificationPanel.tsx uses both to tag content and
 * spin up a new category inline without leaving the session/course editor.
 * Everything else here (viewing inactive categories, editing, deleting) is
 * new — `/admin/categories` was a PlaceholderPage; there was no way to
 * rename a category, deactivate one, reorder the set, or ever delete one
 * short of a raw SQL statement.
 */
export const categoriesRouter = Router();

const CATEGORY_SELECT = {
  id: true,
  name: true,
  name_fr: true,
  slug: true,
  description: true,
  description_fr: true,
  image_url: true,
  show_as_tile: true,
  display_order: true,
  is_active: true,
} as const;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

// GET /categories — active-only by default (ClassificationPanel's own
// tagging list, unchanged from before this pass); ?all=1 additionally
// includes inactive ones, for the admin management page.
categoriesRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.all === "1" || req.query.all === "true";
    const categories = await prisma.category.findMany({
      where: includeInactive ? undefined : { is_active: true },
      orderBy: [{ display_order: "asc" }, { name: "asc" }],
      select: includeInactive ? CATEGORY_SELECT : { id: true, name: true, slug: true, image_url: true },
    });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// GET /categories/:id
categoriesRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid category id");
    const category = await prisma.category.findFirst({ where: { id }, select: CATEGORY_SELECT });
    if (!category) throw new ApiError(404, "Category not found");
    res.json({ category });
  } catch (err) {
    next(err);
  }
});

const CreateSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(100),
  name_fr: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(300).nullable().optional(),
  description_fr: z.string().trim().max(300).nullable().optional(),
  image_url: z.string().trim().max(500).nullable().optional(),
  show_as_tile: z.boolean().default(false),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

// POST /categories — quick-create from the classification panel (just
// {name}) still works exactly as before; the admin page uses the same
// endpoint with the rest of these fields also set, rather than needing a
// second create path.
categoriesRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateSchema.parse(req.body);
    const slug = slugify(body.name);
    const existingSlug = await prisma.category.findFirst({ where: { slug }, select: { id: true } });
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    const category = await prisma.category.create({
      data: {
        name: body.name,
        name_fr: body.name_fr ?? null,
        slug: finalSlug,
        description: body.description ?? null,
        description_fr: body.description_fr ?? null,
        image_url: body.image_url ?? null,
        show_as_tile: body.show_as_tile,
        display_order: body.display_order,
        is_active: body.is_active,
      },
      select: CATEGORY_SELECT,
    });

    res.status(201).json({ category });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

const UpdateSchema = CreateSchema.extend({
  // Renaming doesn't reslug an existing category — every /browse/:slug link
  // anyone has ever shared or bookmarked for it would silently start 404ing
  // the moment an admin fixed a typo in the display name. The slug is only
  // ever set at creation.
});

// PUT /categories/:id
categoriesRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid category id");
    const existing = await prisma.category.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Category not found");

    const body = UpdateSchema.parse(req.body);
    const category = await prisma.category.update({
      where: { id },
      data: {
        name: body.name,
        name_fr: body.name_fr ?? null,
        description: body.description ?? null,
        description_fr: body.description_fr ?? null,
        image_url: body.image_url ?? null,
        show_as_tile: body.show_as_tile,
        display_order: body.display_order,
        is_active: body.is_active,
      },
      select: CATEGORY_SELECT,
    });
    res.json({ category });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /categories/:id — blocked while any content is still tagged with
// it. No FK from content_categories.category_id (this schema declares none
// anywhere — same NCB pattern as every other cross-model reference), so
// deleting wouldn't error on its own; it would silently orphan every one of
// those join rows instead. A category with no content tagged to it carries
// no such history and is safe to remove outright — the same "block, don't
// silently orphan" call Coupons and Plans already make elsewhere.
categoriesRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid category id");
    const existing = await prisma.category.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Category not found");

    const inUse = await prisma.contentCategory.count({ where: { category_id: id } });
    if (inUse > 0) {
      throw new ApiError(409, `${inUse} content item${inUse === 1 ? " is" : "s are"} still tagged with this category. Deactivate it instead of deleting.`);
    }

    await prisma.category.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
