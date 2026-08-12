import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const footerLinksRouter = Router();

// GET /footer-links — grouped by column_group, ordered within each group
footerLinksRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const links = await prisma.footerLink.findMany({ orderBy: [{ column_group: "asc" }, { display_order: "asc" }] });
    const groups = new Map<string, typeof links>();
    for (const link of links) {
      const g = link.column_group ?? "other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(link);
    }
    res.json({ groups: Array.from(groups.entries()).map(([column_group, items]) => ({ column_group, links: items })) });
  } catch (err) {
    next(err);
  }
});

// POST /footer-links — create
const CreateSchema = z.object({
  label: z.string().min(1).max(100),
  label_fr: z.string().max(100).nullable().optional(),
  url: z.string().min(1).max(300),
  column_group: z.string().min(1).max(50),
  opens_new_tab: z.boolean().default(false),
});

footerLinksRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateSchema.parse(req.body);
    const maxOrder = await prisma.footerLink.aggregate({
      where: { column_group: body.column_group },
      _max: { display_order: true },
    });
    const link = await prisma.footerLink.create({
      data: {
        label: body.label,
        label_fr: body.label_fr ?? null,
        url: body.url,
        column_group: body.column_group,
        opens_new_tab: body.opens_new_tab,
        display_order: (maxOrder._max.display_order ?? 0) + 1,
        is_active: true,
        is_required: false,
      },
    });
    res.status(201).json({ link });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /footer-links/:id — edit
const UpdateSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  label_fr: z.string().max(100).nullable().optional(),
  url: z.string().min(1).max(300).optional(),
  opens_new_tab: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

footerLinksRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid footer link id");
    const existing = await prisma.footerLink.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Footer link not found");

    const body = UpdateSchema.parse(req.body);
    const updated = await prisma.footerLink.update({ where: { id }, data: body });
    res.json({ link: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /footer-links/reorder — set display_order within a column_group
footerLinksRouter.put("/reorder/set", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { column_group, ordered_ids } = z.object({
      column_group: z.string().min(1),
      ordered_ids: z.array(z.number().int()),
    }).parse(req.body);

    await Promise.all(
      ordered_ids.map((id, index) =>
        prisma.footerLink.updateMany({ where: { id, column_group }, data: { display_order: index + 1 } }),
      ),
    );
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /footer-links/:id — blocked if is_required
footerLinksRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid footer link id");
    const existing = await prisma.footerLink.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Footer link not found");
    if (existing.is_required) throw new ApiError(409, "This link is required and cannot be deleted.");

    await prisma.footerLink.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
