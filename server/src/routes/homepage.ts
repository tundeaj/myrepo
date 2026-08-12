import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { buildCacheForKey, cacheKey } from "../lib/homepageCache.js";
import type { Request, Response, NextFunction } from "express";

// Public, unauthenticated. This is the Stage 1 read described in PROMPT 09:
// one call returns the hero and every non-personal row already assembled, so the
// page paints without a request per row. The payload contains only the trimmed
// card allowlist built in homepageCache.ts.
export const homepageRouter = Router();

const SURFACES = new Set(["home", "live", "courses", "category", "speaker", "landing"]);
const PLATFORMS = new Set(["web", "mobile"]);
const AUDIENCES = new Set(["logged_out", "registered", "subscriber", "enrolled"]);

homepageRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const surface = typeof req.query.surface === "string" && SURFACES.has(req.query.surface) ? req.query.surface : "home";
    const platform = typeof req.query.platform === "string" && PLATFORMS.has(req.query.platform) ? req.query.platform : "web";
    const audience = typeof req.query.audience === "string" && AUDIENCES.has(req.query.audience) ? req.query.audience : "logged_out";

    const key = cacheKey(surface, platform, audience);
    let entry = await prisma.homepageCache.findFirst({ where: { cache_key: key } });

    // Cold or expired cache: build on demand rather than serving an empty page.
    const stale = !entry || !entry.expires_at || entry.expires_at < new Date();
    if (stale) {
      await buildCacheForKey(surface, platform, audience);
      entry = await prisma.homepageCache.findFirst({ where: { cache_key: key } });
    }

    if (!entry?.payload) {
      return res.json({ surface, platform, audience, rows: [], generated_at: new Date().toISOString() });
    }

    res.setHeader("Cache-Control", "public, max-age=60");
    res.type("application/json").send(entry.payload);
  } catch (err) {
    next(err);
  }
});
