import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Minimal, admin-only, cross-content-type search — used by picker components
 * (Coupons' "applies to content" field today; any future admin feature that
 * needs to reference one piece of content without loading the full Sessions
 * or Courses list). Deliberately NOT the public /api/content surface: this
 * includes drafts and unpublished items, which is correct for an admin tool
 * picking a target and wrong for a public listing.
 *
 * Two modes, not a REST resource: ?q= searches by title/slug; ?ids= resolves
 * specific ids back to their display fields (what a picker needs to show a
 * value someone already saved, without re-running a text search for it).
 */
export const contentSearchRouter = Router();

contentSearchRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const idsParam = typeof req.query.ids === "string" ? req.query.ids : "";
    const ids = idsParam
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    if (ids.length === 0 && !q) {
      return res.json({ items: [] });
    }

    const items = await prisma.contentItem.findMany({
      where:
        ids.length > 0
          ? { id: { in: ids } }
          : { OR: [{ title: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }] },
      select: { id: true, title: true, slug: true, content_type: true, status: true },
      orderBy: { id: "desc" },
      take: 15,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
