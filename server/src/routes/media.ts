import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const mediaRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Count how many content items or lessons reference this asset via content_media */
async function getUsedInCount(assetId: number): Promise<number> {
  return prisma.contentMedia.count({ where: { media_asset_id: assetId } });
}

/** Get all content items and lessons referencing an asset */
async function getReferences(assetId: number) {
  const rows = await prisma.contentMedia.findMany({
    where: { media_asset_id: assetId },
    select: { content_id: true, lesson_id: true, role: true },
  });

  const results: { type: "content" | "lesson"; id: number; title: string; role: string }[] = [];

  for (const row of rows) {
    if (row.content_id) {
      const ci = await prisma.contentItem.findFirst({
        where: { id: row.content_id },
        select: { id: true, title: true, content_type: true },
      });
      if (ci) results.push({ type: "content", id: ci.id, title: ci.title, role: row.role });
    }
    if (row.lesson_id) {
      const lesson = await prisma.courseLesson.findFirst({
        where: { id: row.lesson_id },
        select: { id: true, title: true },
      });
      if (lesson) results.push({ type: "lesson", id: lesson.id, title: lesson.title ?? `Lesson #${lesson.id}`, role: row.role });
    }
  }

  return results;
}

// ─── GET /media — list with pagination ───────────────────────────────────────

mediaRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const view = req.query.view === "list" ? "list" : "grid";
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || (view === "list" ? 25 : 24)));

    const assetType = typeof req.query.asset_type === "string" && req.query.asset_type ? req.query.asset_type : undefined;
    const transcodeStatus = typeof req.query.transcode_status === "string" && req.query.transcode_status ? req.query.transcode_status : undefined;
    const uploadedBy = req.query.uploaded_by ? Number(req.query.uploaded_by) : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Record<string, any> = {
      ...(assetType ? { asset_type: assetType } : {}),
      ...(transcodeStatus ? { transcode_status: transcodeStatus } : {}),
      ...(uploadedBy ? { uploaded_by: uploadedBy } : {}),
      ...(q ? {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { tags: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    };

    const [assets, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.mediaAsset.count({ where }),
    ]);

    // Enrich with used_in count and uploader info
    const enriched = await Promise.all(
      assets.map(async (asset) => {
        const used_in = await getUsedInCount(asset.id);
        let uploader: { id: number; full_name: string | null; email: string } | null = null;
        if (asset.uploaded_by) {
          uploader = await prisma.user.findFirst({
            where: { id: asset.uploaded_by },
            select: { id: true, full_name: true, email: true },
          }) as any;
        }
        return { ...asset, used_in, uploader };
      }),
    );

    res.json({
      assets: enriched,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /media/export-csv — CSV export ──────────────────────────────────────

mediaRouter.get("/export-csv", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assetType = typeof req.query.asset_type === "string" && req.query.asset_type ? req.query.asset_type : undefined;
    const transcodeStatus = typeof req.query.transcode_status === "string" && req.query.transcode_status ? req.query.transcode_status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Record<string, any> = {
      ...(assetType ? { asset_type: assetType } : {}),
      ...(transcodeStatus ? { transcode_status: transcodeStatus } : {}),
      ...(q ? { OR: [
        { title: { contains: q, mode: "insensitive" } },
        { tags: { contains: q, mode: "insensitive" } },
      ]} : {}),
    };

    const assets = await prisma.mediaAsset.findMany({
      where,
      orderBy: { created_at: "desc" },
      take: 10000,
    });

    const header = "id,title,asset_type,source_type,transcode_status,duration_seconds,file_size_mb,created_at";
    const rows = assets.map((a) =>
      [a.id, `"${(a.title ?? "").replace(/"/g, '""')}"`, a.asset_type, a.source_type, a.transcode_status,
       a.duration_seconds ?? "", a.file_size_mb ?? "", a.created_at.toISOString()].join(","),
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="media-${Date.now()}.csv"`);
    res.send([header, ...rows].join("\n"));
  } catch (err) {
    next(err);
  }
});

// ─── POST /media/test-url — test URL reachability ────────────────────────────

mediaRouter.post("/test-url", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = z.object({ url: z.string().url() }).parse(req.body);

    // In production: do a HEAD request to the URL
    // Here: simulate — just validate the URL structure
    const isHls = url.match(/\.(m3u8)(\?|$)/i);
    const isMp4 = url.match(/\.(mp4|mov|webm)(\?|$)/i);
    const isEmbed = url.includes("youtube.com") || url.includes("vimeo.com") || url.includes("embed");

    const type = isHls ? "HLS stream" : isMp4 ? "MP4 video" : isEmbed ? "Embed" : "Unknown";
    res.json({ ok: true, content_type: type, url });
  } catch (err) {
    if (err instanceof z.ZodError) return res.json({ ok: false, error: "Invalid URL" });
    next(err);
  }
});

// ─── POST /media — create asset record ───────────────────────────────────────

const MediaCreateSchema = z.object({
  title: z.string().max(200).nullable().optional(),
  asset_type: z.enum(["video", "audio", "trailer", "substitute", "document"]).default("video"),
  source_type: z.enum(["upload", "hls_url", "mp4_url", "embed_url"]).default("upload"),
  hls_url: z.string().max(500).nullable().optional(),
  mp4_url: z.string().max(500).nullable().optional(),
  embed_url: z.string().max(500).nullable().optional(),
  thumbnail_url: z.string().max(500).nullable().optional(),
  duration_seconds: z.number().int().nonnegative().nullable().optional(),
  file_size_mb: z.number().int().nonnegative().nullable().optional(),
  resolution: z.string().max(20).nullable().optional(),
  tags: z.string().max(500).nullable().optional(),
  is_protected: z.boolean().default(true),
  storage_zone: z.string().max(100).nullable().optional(),
  provider: z.string().max(50).nullable().optional(),
  provider_asset_id: z.string().max(255).nullable().optional(),
});

mediaRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = MediaCreateSchema.parse(req.body);
    const userId = (req as any).user?.id;

    // URL sources cannot be protected
    if (["hls_url", "mp4_url", "embed_url"].includes(body.source_type)) {
      body.is_protected = false;
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        title: body.title ?? null,
        asset_type: body.asset_type as any,
        source_type: body.source_type as any,
        hls_url: body.hls_url ?? null,
        mp4_url: body.mp4_url ?? null,
        embed_url: body.embed_url ?? null,
        thumbnail_url: body.thumbnail_url ?? null,
        duration_seconds: body.duration_seconds ?? null,
        file_size_mb: body.file_size_mb ?? null,
        resolution: body.resolution ?? null,
        tags: body.tags ?? null,
        is_protected: body.is_protected,
        storage_zone: body.storage_zone ?? null,
        provider: body.provider ?? null,
        provider_asset_id: body.provider_asset_id ?? null,
        transcode_status: body.source_type === "upload" ? "pending" : "ready",
        uploaded_by: userId ?? null,
      },
    });

    res.status(201).json({ asset });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /media/:id — single asset ───────────────────────────────────────────

mediaRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid media id");
    const asset = await prisma.mediaAsset.findFirst({ where: { id } });
    if (!asset) throw new ApiError(404, "Asset not found");
    const used_in = await getUsedInCount(id);
    res.json({ asset: { ...asset, used_in } });
  } catch (err) {
    next(err);
  }
});

// ─── GET /media/:id/references — list references ─────────────────────────────

mediaRouter.get("/:id/references", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid media id");
    const refs = await getReferences(id);
    res.json({ references: refs });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /media/:id — update title/tags ──────────────────────────────────────

mediaRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid media id");
    const existing = await prisma.mediaAsset.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Asset not found");

    const body = z.object({
      title: z.string().max(200).nullable().optional(),
      tags: z.string().max(500).nullable().optional(),
      thumbnail_url: z.string().max(500).nullable().optional(),
    }).parse(req.body);

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.thumbnail_url !== undefined ? { thumbnail_url: body.thumbnail_url } : {}),
      },
    });
    res.json({ asset: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── PATCH /media/:id/transcode-status — update transcode status (webhook sim) ─

mediaRouter.patch("/:id/transcode-status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid media id");
    const { status, duration_seconds, resolution, file_size_mb } = z.object({
      status: z.enum(["pending", "processing", "ready", "failed"]),
      duration_seconds: z.number().int().nonnegative().optional(),
      resolution: z.string().max(20).optional(),
      file_size_mb: z.number().int().nonnegative().optional(),
    }).parse(req.body);

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        transcode_status: status as any,
        ...(duration_seconds != null ? { duration_seconds } : {}),
        ...(resolution ? { resolution } : {}),
        ...(file_size_mb != null ? { file_size_mb } : {}),
      },
    });
    res.json({ asset: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── DELETE /media/:id — delete asset (blocked if used_in > 0) ───────────────

mediaRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid media id");
    const existing = await prisma.mediaAsset.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Asset not found");

    const refs = await getReferences(id);
    if (refs.length > 0) {
      return res.status(409).json({
        error: "Cannot delete — asset is in use.",
        references: refs,
      });
    }

    await prisma.mediaAsset.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
