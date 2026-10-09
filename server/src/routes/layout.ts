import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { ROW_TYPES, ROW_TYPE_KEYS, CONDITION_TYPES, getRowType } from "../lib/rowTypes.js";
import { buildRowItems, buildCacheForKey, rebuildAllCaches, activeCacheKeys, cacheKey } from "../lib/homepageCache.js";
import { evaluateRules, DEFAULT_VIEWER_STATE, type ViewerState, type Rule } from "../lib/rowRules.js";
import type { Request, Response, NextFunction } from "express";

export const layoutRouter = Router();

const SURFACES = ["home", "live", "courses", "category", "speaker", "landing"] as const;
const PLATFORMS = ["web", "mobile", "all"] as const;
const AUDIENCES = ["all", "logged_out", "registered", "subscriber", "enrolled"] as const;
const CARD_STYLES = ["poster", "landscape", "numbered", "tile", "speaker"] as const;

// ─── GET /layout/row-types — the fixed catalogue for the Add row picker ──────

layoutRouter.get("/row-types", async (_req: Request, res: Response) => {
  res.json({ row_types: ROW_TYPES, condition_types: CONDITION_TYPES });
});

// ─── GET /layout/rows — rows for one surface+platform, with warnings ─────────

layoutRouter.get("/rows", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const surface = typeof req.query.surface === "string" ? req.query.surface : "home";
    const platform = typeof req.query.platform === "string" ? req.query.platform : "web";
    if (!SURFACES.includes(surface as any)) throw new ApiError(422, "Unknown surface.");
    if (!PLATFORMS.includes(platform as any)) throw new ApiError(422, "Unknown platform.");

    const rows = await prisma.contentRow.findMany({
      where: { surface: surface as any, platform: { in: [platform as any, "all"] } },
      orderBy: [{ is_enabled: "desc" }, { display_order: "asc" }],
    });

    // Non-blocking warnings — surfaced in the UI, never rejected on save.
    const warnings: string[] = [];
    const enabled = rows.filter((r) => r.is_enabled);
    if (enabled.length >= 12) {
      warnings.push(`${enabled.length} rows are enabled. Beyond about 12, viewers rarely scroll far enough to see the rest.`);
    }
    const combos = new Map<string, number>();
    for (const r of enabled) {
      const k = `${r.row_type}:${r.audience}`;
      combos.set(k, (combos.get(k) ?? 0) + 1);
    }
    for (const [combo, count] of combos) {
      if (count > 1) {
        const [type, audience] = combo.split(":");
        const label = getRowType(type)?.label ?? type;
        warnings.push(`"${label}" appears ${count} times for the same audience (${audience.replace(/_/g, " ")}). Viewers will see duplicate content.`);
      }
    }

    // Three-card thumbnail strip per row, so producers can see what a row returns.
    const previews = await Promise.all(
      rows.map(async (row) => {
        const def = getRowType(row.row_type);
        if (def?.personal) return { row_id: row.id, personal: true, thumbnails: [] as string[] };
        let params: Record<string, any> = {};
        if (row.params) { try { params = JSON.parse(row.params); } catch { params = {}; } }
        const result = await buildRowItems(row.row_type, 3, params);
        const thumbnails = (result.items as any[])
          .slice(0, 3)
          .map((i) => i.master_image_url ?? i.image_url ?? null)
          .filter((u): u is string => Boolean(u));
        return { row_id: row.id, personal: false, thumbnails, item_count: result.items.length };
      }),
    );

    res.json({ rows, warnings, previews });
  } catch (err) {
    next(err);
  }
});

// ─── POST /layout/rows — create ──────────────────────────────────────────────

const RowSchema = z.object({
  row_type: z.enum(ROW_TYPE_KEYS as [string, ...string[]], { errorMap: () => ({ message: "Pick a row type from the list." }) }),
  label: z.string().min(1, "A row label is required.").max(120),
  label_fr: z.string().max(120).nullable().optional(),
  surface: z.enum(SURFACES),
  platform: z.enum(PLATFORMS).default("all"),
  audience: z.enum(AUDIENCES).default("all"),
  card_style: z.enum(CARD_STYLES).default("poster"),
  card_limit: z.number().int().min(1).max(30).default(15),
  hide_when_empty: z.boolean().default(true),
  is_enabled: z.boolean().default(true),
  params: z.record(z.union([z.string(), z.number()])).nullable().optional(),
});

function slugifyKey(label: string, rowType: string): string {
  const base = label.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  return base || rowType;
}

layoutRouter.post("/rows", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RowSchema.parse(req.body);

    const maxOrder = await prisma.contentRow.aggregate({
      where: { surface: body.surface as any },
      _max: { display_order: true },
    });

    let rowKey = slugifyKey(body.label, body.row_type);
    const taken = await prisma.contentRow.findFirst({ where: { row_key: rowKey }, select: { id: true } });
    if (taken) rowKey = `${rowKey}-${Date.now().toString(36)}`;

    const row = await prisma.contentRow.create({
      data: {
        row_key: rowKey,
        label: body.label,
        label_fr: body.label_fr ?? null,
        row_type: body.row_type as any,
        surface: body.surface as any,
        platform: body.platform as any,
        audience: body.audience as any,
        card_style: body.card_style as any,
        card_limit: body.card_limit,
        hide_when_empty: body.hide_when_empty,
        is_enabled: body.is_enabled,
        params: body.params ? JSON.stringify(body.params) : null,
        display_order: (maxOrder._max.display_order ?? 0) + 1,
      },
    });

    res.status(201).json({ row });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── PUT /layout/rows/:id — update ───────────────────────────────────────────

layoutRouter.put("/rows/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid row id");
    const existing = await prisma.contentRow.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Row not found");

    const body = RowSchema.partial().parse(req.body);

    const row = await prisma.contentRow.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.label_fr !== undefined ? { label_fr: body.label_fr } : {}),
        ...(body.row_type !== undefined ? { row_type: body.row_type as any } : {}),
        ...(body.platform !== undefined ? { platform: body.platform as any } : {}),
        ...(body.audience !== undefined ? { audience: body.audience as any } : {}),
        ...(body.card_style !== undefined ? { card_style: body.card_style as any } : {}),
        ...(body.card_limit !== undefined ? { card_limit: body.card_limit } : {}),
        ...(body.hide_when_empty !== undefined ? { hide_when_empty: body.hide_when_empty } : {}),
        ...(body.is_enabled !== undefined ? { is_enabled: body.is_enabled } : {}),
        ...(body.params !== undefined ? { params: body.params ? JSON.stringify(body.params) : null } : {}),
      },
    });

    res.json({ row });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── PUT /layout/rows/reorder — drag-to-reorder ──────────────────────────────

layoutRouter.put("/rows/reorder/set", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { surface, ordered_ids } = z.object({
      surface: z.enum(SURFACES),
      ordered_ids: z.array(z.number().int()),
    }).parse(req.body);

    await Promise.all(
      ordered_ids.map((id, index) =>
        prisma.contentRow.updateMany({ where: { id, surface: surface as any }, data: { display_order: index + 1 } }),
      ),
    );

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── DELETE /layout/rows/:id ─────────────────────────────────────────────────

layoutRouter.delete("/rows/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid row id");
    const existing = await prisma.contentRow.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Row not found");
    await prisma.contentRow.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Ordering rules ──────────────────────────────────────────────────────────

layoutRouter.get("/rules", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rules = await prisma.rowRule.findMany({ orderBy: [{ priority: "asc" }, { id: "asc" }] });
    res.json({ rules });
  } catch (err) {
    next(err);
  }
});

const RuleSchema = z.object({
  // Required by the spec: a rule nobody can explain is a rule nobody can debug.
  description: z.string().min(1, "Describe what this rule does and why — this field is required.").max(200),
  condition_type: z.enum(["live_exists", "session_within_hours", "course_progress_gte", "incomplete_progress", "unwatched_replay", "inactive_days", "logged_out", "never_purchased"]),
  condition_value: z.number().int().nullable().optional(),
  promote_row_key: z.string().min(1, "Pick the row this rule promotes.").max(60),
  priority: z.number().int().min(1).max(999).default(10),
  is_enabled: z.boolean().default(true),
});

layoutRouter.post("/rules", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RuleSchema.parse(req.body);
    const needsValue = CONDITION_TYPES.find((c) => c.key === body.condition_type)?.needsValue;
    if (needsValue && body.condition_value == null) {
      throw new ApiError(422, "This condition needs a value.");
    }

    const rule = await prisma.rowRule.create({
      data: {
        rule_key: `${body.condition_type}-${Date.now().toString(36)}`,
        description: body.description,
        condition_type: body.condition_type as any,
        condition_value: body.condition_value ?? null,
        promote_row_key: body.promote_row_key,
        priority: body.priority,
        is_enabled: body.is_enabled,
      },
    });
    res.status(201).json({ rule });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

layoutRouter.put("/rules/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid rule id");
    const existing = await prisma.rowRule.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Rule not found");

    const body = RuleSchema.partial().parse(req.body);
    if (body.description !== undefined && !body.description.trim()) {
      throw new ApiError(422, "Describe what this rule does and why — this field is required.");
    }

    const rule = await prisma.rowRule.update({
      where: { id },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.condition_type !== undefined ? { condition_type: body.condition_type as any } : {}),
        ...(body.condition_value !== undefined ? { condition_value: body.condition_value } : {}),
        ...(body.promote_row_key !== undefined ? { promote_row_key: body.promote_row_key } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.is_enabled !== undefined ? { is_enabled: body.is_enabled } : {}),
      },
    });
    res.json({ rule });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

layoutRouter.delete("/rules/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid rule id");
    const existing = await prisma.rowRule.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Rule not found");
    await prisma.rowRule.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /layout/rules/simulate — the rule simulator ────────────────────────

layoutRouter.post("/rules/simulate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      surface: z.enum(SURFACES).default("home"),
      platform: z.enum(PLATFORMS).default("web"),
      audience: z.enum(AUDIENCES).default("all"),
      state: z.object({
        logged_out: z.boolean().optional(),
        live_exists: z.boolean().optional(),
        next_session_in_hours: z.number().nullable().optional(),
        max_course_progress: z.number().optional(),
        has_incomplete_progress: z.boolean().optional(),
        has_unwatched_replay: z.boolean().optional(),
        days_inactive: z.number().nullable().optional(),
        never_purchased: z.boolean().optional(),
      }).default({}),
    }).parse(req.body);

    const state: ViewerState = { ...DEFAULT_VIEWER_STATE, ...body.state };

    const [rows, rules] = await Promise.all([
      prisma.contentRow.findMany({
        where: {
          surface: body.surface as any,
          is_enabled: true,
          platform: { in: [body.platform as any, "all"] },
          audience: { in: [body.audience as any, "all"] },
        },
        orderBy: { display_order: "asc" },
        select: { id: true, row_key: true, label: true, row_type: true, display_order: true },
      }),
      prisma.rowRule.findMany({ orderBy: [{ priority: "asc" }, { id: "asc" }] }),
    ]);

    const { ordered, fired } = evaluateRules(rows, rules as Rule[], state);

    res.json({
      ordered,
      fired: fired.map((r) => ({ id: r.id, description: r.description, condition_type: r.condition_type, condition_value: r.condition_value, promote_row_key: r.promote_row_key })),
      state,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── Cache control ───────────────────────────────────────────────────────────
//
// The spec describes these as Netlify scheduled/triggered functions. This build
// runs a single Express service, so they are admin-gated endpoints with the same
// contract — a scheduler (cron, Netlify, or the platform's own) calls them.

layoutRouter.get("/cache/status", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [entries, combos] = await Promise.all([
      prisma.homepageCache.findMany({ orderBy: { generated_at: "desc" }, take: 50 }),
      activeCacheKeys(),
    ]);
    res.json({
      entries: entries.map((e) => ({
        cache_key: e.cache_key,
        generated_at: e.generated_at,
        expires_at: e.expires_at,
        row_count: e.row_count,
        item_count: e.item_count,
        is_stale: e.expires_at ? e.expires_at < new Date() : true,
      })),
      expected_keys: combos.map((c) => cacheKey(c.surface, c.platform, c.audience)),
    });
  } catch (err) {
    next(err);
  }
});

/** Equivalent of build-homepage-cache.mjs — full or single-key rebuild. */
layoutRouter.post("/cache/rebuild", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      surface: z.enum(SURFACES).optional(),
      platform: z.enum(["web", "mobile"]).optional(),
      audience: z.enum(["logged_out", "registered", "subscriber", "enrolled"]).optional(),
    }).parse(req.body ?? {});

    if (body.surface && body.platform && body.audience) {
      const result = await buildCacheForKey(body.surface, body.platform, body.audience);
      return res.json({ rebuilt: [result] });
    }

    const results = await rebuildAllCaches();
    res.json({ rebuilt: results });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

/** Equivalent of invalidate-homepage-cache.mjs.
 *  A live status transition rebuilds immediately so the Live Now row is never
 *  stale; every other trigger just clears the key and lets the next build fill it. */
layoutRouter.post("/cache/invalidate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      reason: z.enum(["content_publish", "content_unpublish", "status_live", "status_ended", "status_replay_ready", "row_config", "featured_flag"]),
      surface: z.enum(SURFACES).optional(),
    }).parse(req.body);

    const immediate = ["status_live", "status_ended", "status_replay_ready"].includes(body.reason);

    if (immediate) {
      const combos = (await activeCacheKeys()).filter((c) => !body.surface || c.surface === body.surface);
      const rebuilt = [];
      for (const c of combos) rebuilt.push(await buildCacheForKey(c.surface, c.platform, c.audience));
      return res.json({ action: "rebuilt", reason: body.reason, keys: rebuilt.map((r) => r.cache_key) });
    }

    const where = body.surface ? { cache_key: { startsWith: `${body.surface}:` } } : {};
    const cleared = await prisma.homepageCache.deleteMany({ where });
    res.json({ action: "cleared", reason: body.reason, cleared: cleared.count });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
