import { prisma } from "./prisma.js";
import { getRowType, isPersonalRow } from "./rowTypes.js";
import { endOfWeek, daysAgo } from "./dates.js";

// ─── Card payload ─────────────────────────────────────────────────────────────
//
// The cache is a PUBLIC artifact — it is served to signed-out visitors. The
// allowlist below is enforced by the Prisma `select` itself rather than by
// deleting keys afterwards, so a column added to ContentItem later cannot leak
// into the payload by default. stream_key, password_hash, account_number and
// every is_secret setting are structurally unreachable from here.

const CARD_SELECT = {
  id: true,
  slug: true,
  title: true,
  master_image_url: true,
  focal_x: true,
  focal_y: true,
  status: true,
  scheduled_start_at: true,
  timezone: true,
  scheduled_duration_minutes: true,
  access_level: true,
  price_ngn: true,
  avg_rating: true,
} as const;

type RawCard = {
  id: number;
  slug: string;
  title: string;
  master_image_url: string | null;
  focal_x: number;
  focal_y: number;
  status: string;
  scheduled_start_at: Date | null;
  timezone: string;
  scheduled_duration_minutes: number | null;
  access_level: string;
  price_ngn: unknown;
  avg_rating: unknown;
};

export interface ContentCard {
  id: number;
  slug: string;
  title: string;
  master_image_url: string | null;
  focal_x: number;
  focal_y: number;
  status: string;
  scheduled_start_at: string | null;
  timezone: string;
  scheduled_duration_minutes: number | null;
  access_level: string;
  price_ngn: number | null;
  avg_rating: number;
  speaker_names: string[];
  category_names: string[];
  has_audio_only: boolean;
  duration_seconds: number | null;
}

export interface SpeakerCard {
  id: number;
  slug: string;
  full_name: string;
  title: string | null;
  organisation: string | null;
  master_image_url: string | null;
  focal_x: number;
  focal_y: number;
}

export interface CategoryCard {
  id: number;
  slug: string | null;
  name: string;
  image_url: string | null;
}

/** Batch-hydrates speaker names, category names, audio availability and runtime
 *  for a page of content rows — four queries total regardless of card count. */
async function decorateCards(raw: RawCard[]): Promise<ContentCard[]> {
  if (!raw.length) return [];
  const ids = raw.map((r) => r.id);

  const [speakerLinks, categoryLinks, mediaLinks] = await Promise.all([
    prisma.contentSpeaker.findMany({ where: { content_id: { in: ids } }, select: { content_id: true, speaker_id: true } }),
    prisma.contentCategory.findMany({ where: { content_id: { in: ids } }, select: { content_id: true, category_id: true } }),
    prisma.contentMedia.findMany({
      where: { content_id: { in: ids } },
      select: { content_id: true, media_asset_id: true, role: true },
    }),
  ]);

  const speakerIds = [...new Set(speakerLinks.map((l) => l.speaker_id))];
  const categoryIds = [...new Set(categoryLinks.map((l) => l.category_id))];
  const mainAssetIds = [...new Set(mediaLinks.filter((m) => m.role === "main").map((m) => m.media_asset_id))];

  const [speakers, categories, assets] = await Promise.all([
    speakerIds.length ? prisma.speaker.findMany({ where: { id: { in: speakerIds } }, select: { id: true, full_name: true } }) : [],
    categoryIds.length ? prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } }) : [],
    mainAssetIds.length ? prisma.mediaAsset.findMany({ where: { id: { in: mainAssetIds } }, select: { id: true, duration_seconds: true } }) : [],
  ]);

  const speakerName = new Map(speakers.map((s) => [s.id, s.full_name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const assetDuration = new Map(assets.map((a) => [a.id, a.duration_seconds]));

  return raw.map((r) => {
    const mine = mediaLinks.filter((m) => m.content_id === r.id);
    const mainAsset = mine.find((m) => m.role === "main");
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      master_image_url: r.master_image_url,
      focal_x: r.focal_x,
      focal_y: r.focal_y,
      status: r.status,
      scheduled_start_at: r.scheduled_start_at ? r.scheduled_start_at.toISOString() : null,
      timezone: r.timezone,
      scheduled_duration_minutes: r.scheduled_duration_minutes,
      access_level: r.access_level,
      price_ngn: r.price_ngn != null ? Number(r.price_ngn) : null,
      avg_rating: r.avg_rating != null ? Number(r.avg_rating) : 0,
      speaker_names: speakerLinks.filter((l) => l.content_id === r.id).map((l) => speakerName.get(l.speaker_id)).filter((n): n is string => Boolean(n)),
      category_names: categoryLinks.filter((l) => l.content_id === r.id).map((l) => categoryName.get(l.category_id)).filter((n): n is string => Boolean(n)),
      has_audio_only: mine.some((m) => m.role === "audio_only"),
      duration_seconds: mainAsset ? assetDuration.get(mainAsset.media_asset_id) ?? null : null,
    };
  });
}

// Statuses a signed-out visitor may see in a row.
const VISIBLE_STATUSES = ["scheduled", "registration_open", "starting_soon", "live", "ended", "replay_ready"] as const;

function visibleWhere(extra: Record<string, any> = {}) {
  return { is_active: true, status: { in: [...VISIBLE_STATUSES] }, ...extra };
}

// ─── Row queries ──────────────────────────────────────────────────────────────
//
// One function per row type. This is the reason the row builder has no free-text
// query field: every row a producer can create resolves to code reviewed here.

export interface RowItems {
  kind: "content" | "speaker" | "category";
  items: ContentCard[] | SpeakerCard[] | CategoryCard[];
}

export async function buildRowItems(rowType: string, limit: number, params: Record<string, any> = {}): Promise<RowItems> {
  const now = new Date();
  const take = Math.min(Math.max(limit, 1), 30);

  const contentRows = async (where: Record<string, any>, orderBy: any, n = take): Promise<RowItems> => {
    const raw = await prisma.contentItem.findMany({ where, orderBy, take: n, select: CARD_SELECT });
    return { kind: "content", items: await decorateCards(raw as RawCard[]) };
  };

  switch (rowType) {
    case "live_now":
      return contentRows({ is_active: true, status: "live" }, { scheduled_start_at: "desc" });

    case "starting_soon":
      return contentRows(
        visibleWhere({ scheduled_start_at: { gte: now, lte: new Date(now.getTime() + 2 * 3600_000) } }),
        { scheduled_start_at: "asc" },
      );

    case "this_week":
      return contentRows(
        visibleWhere({ scheduled_start_at: { gte: now, lte: endOfWeek(now) } }),
        { scheduled_start_at: "asc" },
      );

    case "just_added":
      return contentRows(visibleWhere(), { created_at: "desc" });

    case "free_this_week":
      return contentRows(
        visibleWhere({ access_level: { in: ["public", "registered"] }, created_at: { gte: daysAgo(7, now) } }),
        { created_at: "desc" },
      );

    case "upgrade_teaser":
      return contentRows(visibleWhere({ access_level: "subscriber" }), { created_at: "desc" });

    case "top_ten":
      return contentRows(visibleWhere(), { view_count: "desc" }, Math.min(take, 10));

    case "popular_in_industry":
      return contentRows(visibleWhere(), { registration_count: "desc" });

    case "similar_to_watched":
      // Cache-time fallback: the signed-out approximation is simply what's popular.
      // The personalised variant is computed per-viewer in the Stage 2 call.
      return contentRows(visibleWhere({ is_featured: true }), { view_count: "desc" });

    case "highest_rated":
      return contentRows(visibleWhere({ rating_count: { gte: 3 } }), [{ avg_rating: "desc" }, { rating_count: "desc" }]);

    case "under_30_min":
      return contentRows(
        visibleWhere({ scheduled_duration_minutes: { lt: 30, gt: 0 } }),
        { created_at: "desc" },
      );

    case "audio_available": {
      const links = await prisma.contentMedia.findMany({
        where: { role: "audio_only", content_id: { not: null } },
        select: { content_id: true },
        take: take * 3,
      });
      const ids = [...new Set(links.map((l) => l.content_id!))];
      if (!ids.length) return { kind: "content", items: [] };
      return contentRows(visibleWhere({ id: { in: ids } }), { created_at: "desc" });
    }

    case "most_attended": {
      // Real attendance, not a registration proxy — worth the extra pass because
      // this runs on the cache schedule, not per request.
      const ended = await prisma.contentItem.findMany({
        where: visibleWhere({ status: { in: ["ended", "replay_ready"] } }),
        select: { id: true },
        take: 200,
      });
      if (!ended.length) return { kind: "content", items: [] };
      const regs = await prisma.registration.findMany({
        where: { content_id: { in: ended.map((e) => e.id) } },
        select: { id: true, content_id: true },
      });
      const attended = regs.length
        ? await prisma.attendance.findMany({
            where: { registration_id: { in: regs.map((r) => r.id) }, attended: true },
            select: { registration_id: true },
          })
        : [];
      const attendedRegIds = new Set(attended.map((a) => a.registration_id));
      const tally = new Map<number, number>();
      for (const r of regs) {
        if (attendedRegIds.has(r.id)) tally.set(r.content_id, (tally.get(r.content_id) ?? 0) + 1);
      }
      const topIds = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, take).map(([id]) => id);
      if (!topIds.length) return { kind: "content", items: [] };
      const raw = await prisma.contentItem.findMany({ where: { id: { in: topIds } }, select: CARD_SELECT });
      const cards = await decorateCards(raw as RawCard[]);
      cards.sort((a, b) => topIds.indexOf(a.id) - topIds.indexOf(b.id));
      return { kind: "content", items: cards };
    }

    case "by_speaker": {
      const speakerId = Number(params.speaker_id);
      if (!Number.isFinite(speakerId) || speakerId <= 0) return { kind: "content", items: [] };
      const links = await prisma.contentSpeaker.findMany({ where: { speaker_id: speakerId }, select: { content_id: true }, take: take * 2 });
      const ids = links.map((l) => l.content_id);
      if (!ids.length) return { kind: "content", items: [] };
      return contentRows(visibleWhere({ id: { in: ids } }), { scheduled_start_at: "desc" });
    }

    case "category_tiles": {
      const categories = await prisma.category.findMany({
        where: { is_active: true, show_as_tile: true },
        orderBy: [{ display_order: "asc" }, { name: "asc" }],
        take,
        select: { id: true, slug: true, name: true, image_url: true },
      });
      return { kind: "category", items: categories as CategoryCard[] };
    }

    case "featured_speakers":
    case "new_instructors": {
      const where = rowType === "new_instructors"
        ? { is_active: true, created_at: { gte: daysAgo(60, now) } }
        : { is_active: true };
      const speakers = await prisma.speaker.findMany({
        where,
        orderBy: { created_at: "desc" },
        take,
        select: { id: true, slug: true, full_name: true, title: true, organisation: true, master_image_url: true, focal_x: true, focal_y: true },
      });
      return { kind: "speaker", items: speakers as SpeakerCard[] };
    }

    default:
      // Personal rows resolve per-viewer, never at cache time.
      return { kind: "content", items: [] };
  }
}

// ─── Cache assembly ───────────────────────────────────────────────────────────

export function cacheKey(surface: string, platform: string, audience: string): string {
  return `${surface}:${platform}:${audience}`;
}

async function cacheTtlMinutes(): Promise<number> {
  const row = await prisma.setting.findFirst({ where: { setting_key: "playback.homepage_cache_minutes" } });
  const n = Number(row?.setting_value);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export interface CachedRow {
  row_key: string | null;
  label: string | null;
  label_fr: string | null;
  row_type: string;
  card_style: string;
  card_limit: number;
  display_order: number;
  hide_when_empty: boolean;
  personal: boolean;
  kind: "content" | "speaker" | "category";
  items: unknown[];
}

/** Rebuilds one surface/platform/audience combination and writes it to homepage_cache. */
export async function buildCacheForKey(surface: string, platform: string, audience: string) {
  const rows = await prisma.contentRow.findMany({
    where: {
      surface: surface as any,
      is_enabled: true,
      platform: { in: [platform as any, "all"] },
      audience: { in: [audience as any, "all"] },
    },
    orderBy: { display_order: "asc" },
  });

  const built: CachedRow[] = [];
  for (const row of rows) {
    const personal = isPersonalRow(row.row_type);
    let params: Record<string, any> = {};
    if (row.params) {
      try { params = JSON.parse(row.params); } catch { params = {}; }
    }

    // Personal rows are placeholders in the shared cache — the client fills them
    // in Stage 2. Emitting the slot (rather than omitting it) is what keeps the
    // layout from shifting when the personal payload lands.
    const result: RowItems = personal
      ? { kind: "content", items: [] }
      : await buildRowItems(row.row_type, row.card_limit, params);

    if (!personal && result.items.length === 0 && row.hide_when_empty) continue;

    built.push({
      row_key: row.row_key,
      label: row.label,
      label_fr: row.label_fr,
      row_type: row.row_type,
      card_style: row.card_style,
      card_limit: row.card_limit,
      display_order: row.display_order,
      hide_when_empty: row.hide_when_empty,
      personal,
      kind: result.kind,
      items: result.items,
    });
  }

  const ttl = await cacheTtlMinutes();
  const payload = JSON.stringify({ surface, platform, audience, rows: built, generated_at: new Date().toISOString() });
  const itemCount = built.reduce((sum, r) => sum + r.items.length, 0);
  const key = cacheKey(surface, platform, audience);

  await prisma.homepageCache.upsert({
    where: { cache_key: key },
    update: { payload, generated_at: new Date(), expires_at: new Date(Date.now() + ttl * 60_000), row_count: built.length, item_count: itemCount },
    create: { cache_key: key, payload, expires_at: new Date(Date.now() + ttl * 60_000), row_count: built.length, item_count: itemCount },
  });

  return { cache_key: key, row_count: built.length, item_count: itemCount };
}

/** Every surface/platform/audience combination that has at least one enabled row. */
export async function activeCacheKeys(): Promise<{ surface: string; platform: string; audience: string }[]> {
  const rows = await prisma.contentRow.findMany({
    where: { is_enabled: true },
    select: { surface: true, platform: true, audience: true },
  });

  const platforms = ["web", "mobile"];
  const audiences = ["logged_out", "registered", "subscriber", "enrolled"];
  const surfaces = [...new Set(rows.map((r) => r.surface).filter((s): s is NonNullable<typeof s> => Boolean(s)))];

  const combos: { surface: string; platform: string; audience: string }[] = [];
  for (const surface of surfaces) {
    for (const platform of platforms) {
      for (const audience of audiences) {
        combos.push({ surface, platform, audience });
      }
    }
  }
  return combos;
}

/** Full rebuild across every active combination — the scheduled job's entry point. */
export async function rebuildAllCaches() {
  const combos = await activeCacheKeys();
  const results = [];
  for (const c of combos) {
    results.push(await buildCacheForKey(c.surface, c.platform, c.audience));
  }
  return results;
}
