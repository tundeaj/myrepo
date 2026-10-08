import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { toCsv, parseCsvRecords } from "../lib/csv.js";
import type { Request, Response, NextFunction } from "express";

/**
 * `/admin/bulk-import` was a PlaceholderPage with no schema behind it at
 * all ("a future data-tools prompt") — Bulk Import/Export could mean
 * almost anything. Scoped narrowly, confirmed with the user before
 * building: CSV export + import for the two simplest flat entities
 * already in the schema — Speakers and Categories — not every entity in
 * the app, and not a generic import framework.
 *
 * Import is per-row, never all-or-nothing: a CSV an admin pastes from a
 * spreadsheet will often have a typo'd row, and rejecting the whole file
 * over one bad row is worse than creating the 40 good ones and reporting
 * the 1 bad one back — same "one bad item never sinks the rest of the
 * batch" principle the ratings bulk-moderation endpoint already applies.
 *
 * Sensitive/relational fields are deliberately excluded from both
 * directions: a Speaker's bank details and payout-verification state, and
 * any content <-> category/speaker linkage, stay exclusively in their own
 * dedicated admin surfaces (Speakers, Categories, the session/course
 * editor's classification panel) — bulk import only ever creates new,
 * unlinked, unverified rows of the entity itself.
 */
export const bulkImportRouter = Router();

// ─── Speakers ───────────────────────────────────────────────────────────────

const SPEAKER_COLUMNS = ["full_name", "email", "phone", "title", "organisation", "bio"] as const;

function speakerSlug(fullName: string): string {
  return fullName
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 170);
}

bulkImportRouter.get("/speakers/export", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const speakers = await prisma.speaker.findMany({
      orderBy: { full_name: "asc" },
      select: { full_name: true, email: true, phone: true, title: true, organisation: true, bio: true },
    });
    const rows = speakers.map((s) => ({
      full_name: s.full_name,
      email: s.email ?? "",
      phone: s.phone ?? "",
      title: s.title ?? "",
      organisation: s.organisation ?? "",
      bio: s.bio ?? "",
    }));
    const csv = toCsv(rows, [...SPEAKER_COLUMNS]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="speakers.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

bulkImportRouter.post("/speakers/import", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ csv: z.string().min(1, "A CSV file is required.") }).parse(req.body);
    const records = parseCsvRecords(body.csv);
    if (records.length > 500) throw new ApiError(422, "At most 500 rows at a time.");

    const created: { row: number; full_name: string }[] = [];
    const failed: { row: number; error: string }[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const fullName = (record.full_name ?? "").trim();
      if (!fullName) {
        failed.push({ row: i + 2, error: "full_name is required." }); // +2: header is row 1, data is 1-indexed
        continue;
      }
      try {
        const slug = speakerSlug(fullName);
        const existingSlug = await prisma.speaker.findFirst({ where: { slug }, select: { id: true } });
        const finalSlug = existingSlug ? `${slug}-${Date.now()}-${i}` : slug;
        await prisma.speaker.create({
          data: {
            full_name: fullName,
            slug: finalSlug,
            email: record.email?.trim() || null,
            phone: record.phone?.trim() || null,
            title: record.title?.trim() || null,
            organisation: record.organisation?.trim() || null,
            bio: record.bio?.trim() || null,
          },
        });
        created.push({ row: i + 2, full_name: fullName });
      } catch (err) {
        failed.push({ row: i + 2, error: err instanceof Error ? err.message : "Failed to create." });
      }
    }

    res.status(201).json({ created, failed });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── Categories ─────────────────────────────────────────────────────────────

const CATEGORY_COLUMNS = ["name", "description", "display_order", "show_as_tile", "is_active"] as const;

function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function parseBoolCell(value: string | undefined, fallback: boolean): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

bulkImportRouter.get("/categories/export", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: [{ display_order: "asc" }, { name: "asc" }],
      select: { name: true, description: true, display_order: true, show_as_tile: true, is_active: true },
    });
    const rows = categories.map((c) => ({
      name: c.name,
      description: c.description ?? "",
      display_order: String(c.display_order),
      show_as_tile: String(c.show_as_tile),
      is_active: String(c.is_active),
    }));
    const csv = toCsv(rows, [...CATEGORY_COLUMNS]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="categories.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

bulkImportRouter.post("/categories/import", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ csv: z.string().min(1, "A CSV file is required.") }).parse(req.body);
    const records = parseCsvRecords(body.csv);
    if (records.length > 500) throw new ApiError(422, "At most 500 rows at a time.");

    const created: { row: number; name: string }[] = [];
    const failed: { row: number; error: string }[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const name = (record.name ?? "").trim();
      if (!name) {
        failed.push({ row: i + 2, error: "name is required." });
        continue;
      }
      const displayOrder = Number(record.display_order);
      try {
        const slug = categorySlug(name);
        const existingSlug = await prisma.category.findFirst({ where: { slug }, select: { id: true } });
        const finalSlug = existingSlug ? `${slug}-${Date.now()}-${i}` : slug;
        await prisma.category.create({
          data: {
            name,
            slug: finalSlug,
            description: record.description?.trim() || null,
            display_order: Number.isFinite(displayOrder) ? displayOrder : 0,
            show_as_tile: parseBoolCell(record.show_as_tile, false),
            is_active: parseBoolCell(record.is_active, true),
          },
        });
        created.push({ row: i + 2, name });
      } catch (err) {
        failed.push({ row: i + 2, error: err instanceof Error ? err.message : "Failed to create." });
      }
    }

    res.status(201).json({ created, failed });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});
