import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const imageVariantsRouter = Router();

// GET /image-variants — ordered list
imageVariantsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const variants = await prisma.imageVariant.findMany({ orderBy: { display_order: "asc" } });
    res.json({ variants });
  } catch (err) {
    next(err);
  }
});

// PUT /image-variants/:id — edit dimensions/transform/active
const UpdateSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  aspect_ratio: z.string().min(1).max(10).optional(),
  imagekit_transform: z.string().min(1).max(200).optional(),
  usage_note: z.string().max(200).nullable().optional(),
  is_active: z.boolean().optional(),
});

imageVariantsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid image variant id");
    const existing = await prisma.imageVariant.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Image variant not found");

    const body = UpdateSchema.parse(req.body);
    const updated = await prisma.imageVariant.update({ where: { id }, data: body });
    res.json({ variant: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
