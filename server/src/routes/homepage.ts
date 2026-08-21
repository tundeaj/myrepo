import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { buildCacheForKey, cacheKey, buildPersonalRows, buildLiveRows } from "../lib/homepageCache.js";
import { verifyToken } from "../lib/jwt.js";
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

// ─── Stage 2 — every personal row in one authenticated call ──────────────────
//
// One call, not one per row. Auth is read directly rather than via requireAuth
// so an expired token degrades to "no personal rows" instead of failing the page.

homepageRouter.get("/personal", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.json({ rows: [] });

    let userId: number;
    try {
      userId = verifyToken(header.slice("Bearer ".length)).sub;
    } catch {
      return res.json({ rows: [] });
    }

    const surface = typeof req.query.surface === "string" && SURFACES.has(req.query.surface) ? req.query.surface : "home";
    const platform = typeof req.query.platform === "string" && PLATFORMS.has(req.query.platform) ? req.query.platform : "web";
    const audience = typeof req.query.audience === "string" && AUDIENCES.has(req.query.audience) ? req.query.audience : "registered";

    const rows = await buildPersonalRows(userId, surface, platform, audience);
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

// ─── Stage 3 — live poll ─────────────────────────────────────────────────────
//
// Returns only Live Now and Starting Soon so the client can patch those two
// carousels and the countdown timers without re-rendering the page.

homepageRouter.get("/live", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const surface = typeof req.query.surface === "string" && SURFACES.has(req.query.surface) ? req.query.surface : "home";
    const platform = typeof req.query.platform === "string" && PLATFORMS.has(req.query.platform) ? req.query.platform : "web";
    const audience = typeof req.query.audience === "string" && AUDIENCES.has(req.query.audience) ? req.query.audience : "logged_out";

    const rows = await buildLiveRows(surface, platform, audience);
    res.setHeader("Cache-Control", "no-store");
    res.json({ rows, polled_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});
