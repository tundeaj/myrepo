-- Trending/hero carousel: admin-controlled ordering. Hand-written the same
-- way as prior migrations this session — `prisma migrate dev` fails in this
-- sandbox ("environment is non-interactive"); generated via
-- `prisma migrate diff --from-migrations ... --to-schema-datamodel ...`.

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "hero_display_order" INTEGER NOT NULL DEFAULT 0;

-- Backfill: any content already flagged show_in_hero=true predates this
-- column and would otherwise all tie at hero_display_order=0. Assign each a
-- distinct, sequential position using the same ordering buildHero()'s
-- fallback already uses (scheduled_start_at desc), so the trending admin
-- page opens to a sane, distinct order on day one rather than an undefined
-- tie-break — nothing about this changes which items are trending, only
-- what order they start in.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY scheduled_start_at DESC NULLS LAST, id ASC) AS rn
  FROM "content_items"
  WHERE show_in_hero = true
)
UPDATE "content_items"
SET hero_display_order = ranked.rn
FROM ranked
WHERE "content_items".id = ranked.id;
