import { prisma } from "./prisma.js";
import type { SponsorPlacement } from "@prisma/client";

/**
 * The single source of truth for "is this content_sponsors link currently
 * showable on the public site" — shared by every public surface that
 * renders a sponsor: routes/content.ts's detail payload (session_page and
 * player placements) and homepageCache.ts's buildHero() (hero placement).
 * Before this existed, content.ts had its own inline copy of this exact
 * query, session_page-only; extracted here so a second copy for player/hero
 * couldn't drift from the rule contentSponsors.ts itself enforces at write
 * time.
 *
 * A link is showable when its window is open — starts_at/ends_at unset on
 * either side means open-ended — AND its sponsor is still active, re-checked
 * live here rather than trusted from write time, so a sponsor deactivated
 * after a link was created disappears from every public surface without the
 * link itself needing to change.
 *
 * Only public-safe sponsor fields are selected; a sponsor's contact_email
 * never enters this query at all.
 */

export interface PublicSponsor {
  id: number;
  name: string | null;
  logo_url: string | null;
  website_url: string | null;
  message: string | null;
  placement: string;
}

export async function resolveActiveSponsors(
  contentIds: number[],
  placements: readonly SponsorPlacement[],
): Promise<Map<number, PublicSponsor[]>> {
  if (!contentIds.length || !placements.length) return new Map();

  const now = new Date();
  const links = await prisma.contentSponsor.findMany({
    where: {
      content_id: { in: contentIds },
      placement: { in: [...placements] },
      AND: [
        { OR: [{ starts_at: null }, { starts_at: { lte: now } }] },
        { OR: [{ ends_at: null }, { ends_at: { gte: now } }] },
      ],
    },
    select: { content_id: true, sponsor_id: true, message: true, placement: true },
    orderBy: { id: "asc" },
  });
  if (!links.length) return new Map();

  const sponsorEntities = await prisma.sponsor.findMany({
    where: { id: { in: [...new Set(links.map((l) => l.sponsor_id))] }, is_active: true },
    select: { id: true, name: true, logo_url: true, website_url: true },
  });
  const sponsorById = new Map(sponsorEntities.map((s) => [s.id, s]));

  const byContent = new Map<number, PublicSponsor[]>();
  for (const link of links) {
    const sponsor = sponsorById.get(link.sponsor_id);
    if (!sponsor) continue;
    const list = byContent.get(link.content_id) ?? [];
    list.push({ ...sponsor, message: link.message, placement: link.placement! });
    byContent.set(link.content_id, list);
  }
  return byContent;
}
