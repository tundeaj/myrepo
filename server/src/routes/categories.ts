import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const categoriesRouter = Router();

// GET /categories — list all active categories
categoriesRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      where: { is_active: true },
      orderBy: [{ display_order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, image_url: true },
    });
    res.json({ categories });
  } catch (err) {
    next(err);
  }
});

// POST /categories — quick-create from the classification panel
categoriesRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(100),
    }).parse(req.body);

    const slug = body.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120);

    const existingSlug = await prisma.category.findFirst({ where: { slug }, select: { id: true } });
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    const category = await prisma.category.create({
      data: { name: body.name, slug: finalSlug },
    });

    res.status(201).json({ category });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
