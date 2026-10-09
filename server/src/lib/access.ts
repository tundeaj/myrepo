import { prisma } from "./prisma.js";
import { VISIBLE_STATUSES } from "./homepageCache.js";
import { LIVE_STATUSES } from "../routes/plans.js";

/**
 * The single access decision for the whole platform.
 *
 * Every surface that asks "may this viewer see this?" calls resolveAccess and
 * nothing else. Routes do not re-derive the ladder. That rule exists because the
 * public detail page (Prompt 11) ships before the signed-in branches (Prompt 12):
 * a route that hand-rolls "is this public?" today is the hole the paywall leaks
 * through when the player lands.
 *
 * Prompt 11 implemented the signed-out path; Prompt 12 filled the four signed-in
 * branches behind the same signature, so nothing that called this had to change.
 * Refusal remains the default in every branch: a lookup that finds nothing falls
 * through to a refusal rather than past it.
 */

export type AccessReason =
  // Granted
  | "public"
  | "registered"
  | "entitled"
  | "subscribed"
  | "cohort"
  // Refused
  | "needs_signin"
  | "needs_registration"
  | "needs_purchase"
  | "needs_subscription"
  | "not_enrolled"
  | "unavailable";

export interface AccessResult {
  can_view: boolean;
  reason: AccessReason;
  /** content_items.free_preview_seconds — how much the player may show before gating. */
  preview_seconds: number;
  /** Populated for `purchase` content whether or not anyone is signed in: the price
   *  is public information, the buying is what's gated. */
  price_ngn: number | null;
  /** The same content's independent USD price, for a Stripe checkout option
   *  alongside the Paystack one price_ngn implies — see ContentItem.price_usd's
   *  doc comment in schema.prisma. null under the exact same conditions as
   *  price_ngn (not purchase-tier, or refused before either is meaningful),
   *  and independently null even on purchase-tier content with no USD price set. */
  price_usd: number | null;
  registration_id: number | null;
  /** A capability: possession is access to that session. Set only when can_view. */
  join_token: string | null;
  /** null for a native session (the frontend already knows to route to
   *  /watch/:slug/play itself — no change there) or when access is refused.
   *  Set to the real external join link for a granted, non-native session,
   *  so AccessGate's button works identically regardless of backend — see
   *  lib/meetingProviders/. Never the host/start link; that stays
   *  admin-only, same discipline as stream_key never appearing here either. */
  join_url: string | null;
}

/** Only the columns the decision needs. Nothing here reaches a response body. */
const ACCESS_SELECT = {
  id: true,
  status: true,
  is_active: true,
  expires_at: true,
  access_level: true,
  price_ngn: true,
  price_usd: true,
  free_preview_seconds: true,
  meeting_provider: true,
  meeting_join_url: true,
} as const;

function joinUrlFor(content: { meeting_provider: string; meeting_join_url: string | null }): string | null {
  return content.meeting_provider === "native" ? null : content.meeting_join_url;
}

function refuse(
  reason: AccessReason,
  preview = 0,
  priceNgn: number | null = null,
  priceUsd: number | null = null,
): AccessResult {
  return {
    can_view: false,
    reason,
    preview_seconds: preview,
    price_ngn: priceNgn,
    price_usd: priceUsd,
    registration_id: null,
    join_token: null,
    join_url: null,
  };
}

/** Granted, with no registration attached. Only `registered` content carries a
 *  join_token — it is the per-registration capability for one session. */
function grant(
  reason: AccessReason,
  preview: number,
  priceNgn: number | null,
  priceUsd: number | null,
  joinUrl: string | null,
): AccessResult {
  return {
    can_view: true,
    reason,
    preview_seconds: preview,
    price_ngn: priceNgn,
    price_usd: priceUsd,
    registration_id: null,
    join_token: null,
    join_url: joinUrl,
  };
}

export async function resolveAccess(
  userId: number | null,
  contentId: number,
): Promise<AccessResult> {
  const content = await prisma.contentItem.findUnique({
    where: { id: contentId },
    select: ACCESS_SELECT,
  });

  // Missing, hidden, withdrawn and expired all answer the same way. A distinct
  // "not published yet" would tell a competitor what is coming.
  if (
    !content ||
    !content.is_active ||
    !VISIBLE_STATUSES.includes(content.status as (typeof VISIBLE_STATUSES)[number]) ||
    (content.expires_at && content.expires_at <= new Date())
  ) {
    return refuse("unavailable");
  }

  const preview = content.free_preview_seconds ?? 0;
  // Price rides along on every purchase-tier result, granted or refused, so the
  // card and the gate can print it without a second query. Both currencies
  // ride along independently — a purchase-tier item can have either, both, or
  // (until an admin sets one) neither price set.
  const isPurchase = content.access_level === "purchase";
  const priceNgn = isPurchase && content.price_ngn != null ? Number(content.price_ngn) : null;
  const priceUsd = isPurchase && content.price_usd != null ? Number(content.price_usd) : null;

  if (content.access_level === "public") {
    return {
      can_view: true,
      reason: "public",
      preview_seconds: preview,
      price_ngn: priceNgn,
      price_usd: priceUsd,
      registration_id: null,
      join_token: null,
      join_url: joinUrlFor(content),
    };
  }

  // Signed out, on any gated level. Not needs_purchase or needs_subscription —
  // this visitor may already own the thing. "Sign in and I'll tell you" is the
  // only honest answer, and it is correct for all four gated levels.
  if (userId === null) {
    return refuse("needs_signin", preview, priceNgn, priceUsd);
  }

  // Signed in, on a gated level. Each branch looks for the one thing that grants
  // access at that level and refuses otherwise — the refusal is the default, so
  // a lookup that returns nothing fails closed rather than falling through.
  switch (content.access_level) {
    case "registered": {
      // Only `confirmed` grants. A waitlisted viewer holds a place in a queue,
      // not a ticket; a cancelled one held a ticket and gave it up.
      const registration = await prisma.registration.findFirst({
        where: { user_id: userId, content_id: contentId, status: "confirmed" },
        select: { id: true, join_token: true },
      });
      if (!registration) return refuse("needs_registration", preview, priceNgn, priceUsd);
      return {
        can_view: true,
        reason: "registered",
        preview_seconds: preview,
        price_ngn: priceNgn,
        price_usd: priceUsd,
        registration_id: registration.id,
        join_token: registration.join_token,
        join_url: joinUrlFor(content),
      };
    }

    case "subscriber": {
      // LIVE_STATUSES is imported, not restated. `past_due` and `paused` still
      // grant: cutting a paying subscriber off the moment a card fails is how you
      // turn a retry into a cancellation.
      const subscription = await prisma.subscription.findFirst({
        where: { user_id: userId, status: { in: [...LIVE_STATUSES] } },
        select: { id: true },
      });
      if (!subscription) return refuse("needs_subscription", preview, priceNgn, priceUsd);
      return grant("subscribed", preview, priceNgn, priceUsd, joinUrlFor(content));
    }

    case "purchase": {
      const entitlement = await prisma.entitlement.findFirst({
        where: {
          user_id: userId,
          content_id: contentId,
          OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
        },
        select: { id: true },
      });
      if (!entitlement) return refuse("needs_purchase", preview, priceNgn, priceUsd);
      return grant("entitled", preview, priceNgn, priceUsd, joinUrlFor(content));
    }

    case "cohort": {
      // Deliberately narrow: source must be `cohort`. A subscription never
      // implies a cohort place — those are granted by a human, not bought.
      const place = await prisma.entitlement.findFirst({
        where: {
          user_id: userId,
          content_id: contentId,
          source: "cohort",
          OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
        },
        select: { id: true },
      });
      if (!place) return refuse("not_enrolled", preview, priceNgn, priceUsd);
      return grant("cohort", preview, priceNgn, priceUsd, joinUrlFor(content));
    }

    default:
      return refuse("unavailable");
  }
}
