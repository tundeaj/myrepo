import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const modulesRouter = Router();

const TIER_ORDER = ["core", "growth", "enterprise"] as const;

// GET /modules — grouped by tier
modulesRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const modules = await prisma.appModule.findMany({ orderBy: { label: "asc" } });
    const grouped = TIER_ORDER.map((tier) => ({
      tier,
      modules: modules.filter((m) => m.tier === tier),
    }));
    res.json({ groups: grouped });
  } catch (err) {
    next(err);
  }
});

// PUT /modules/:flag_key — toggle on/off
modulesRouter.put("/:flag_key", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flag_key = req.params.flag_key;
    const existing = await prisma.appModule.findFirst({ where: { flag_key } });
    if (!existing) throw new ApiError(404, "Module not found.");

    const { is_enabled } = z.object({ is_enabled: z.boolean() }).parse(req.body);

    const updated = await prisma.appModule.update({
      where: { flag_key },
      data: { is_enabled, updated_by: req.user?.sub ?? null },
    });
    res.json({ module: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
