import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import type { Request, Response, NextFunction } from "express";

export const mediaRouter = Router();

// GET /media — list media assets (for VOD picker, etc.)
mediaRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 24));
    const assetType = typeof req.query.asset_type === "string" ? req.query.asset_type : undefined;
    const transcodeStatus = typeof req.query.transcode_status === "string" ? req.query.transcode_status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Record<string, any> = {
      ...(assetType ? { asset_type: assetType } : {}),
      ...(transcodeStatus ? { transcode_status: transcodeStatus } : {}),
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    };

    const [assets, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          title: true,
          asset_type: true,
          transcode_status: true,
          duration_seconds: true,
          file_size_mb: true,
          thumbnail_url: true,
          hls_url: true,
          created_at: true,
        },
      }),
      prisma.mediaAsset.count({ where }),
    ]);

    res.json({
      assets,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});
