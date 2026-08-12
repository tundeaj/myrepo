import { prisma } from "./prisma.js";
import { VISIBLE_STATUSES } from "./homepageCache.js";

/**
 * The single access decision for the whole platform.
 *
 * Every surface that asks "may this viewer see this?" calls resolveAccess and
 * nothing else. Routes do not re-derive the ladder. That rule exists because the
 * public detail page (Prompt 11) ships before the signed-in branches (Prompt 12):
 * a route that hand-rolls "is this public?" today is the hole the paywall leaks
 * through when the player lands.
 *
 * Prompt 11 implements the signed-out path completely — it is fully determinate.
 * The four signed-in branches fail closed until Prompt 12 adds the grant lookups:
 * they refuse with the right reason, so the gate renders correctly and no path
 * can leak access before the checks exist.
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
  registration_id: number | null;
  /** A capability: possession is access to that session. Set only when can_view. */
  join_token: string | null;
}

/** Only the columns the decision needs. Nothing here reaches a response body. */
const ACCESS_SELECT = {
  id: true,
  status: true,
  is_active: true,
  expires_at: true,
  access_level: true,
  price_ngn: true,
  free_preview_seconds: true,
} as const;

function refuse(reason: AccessReason, preview = 0, price: number | null = null): AccessResult {
  return {
    can_view: false,
    reason,
    preview_seconds: preview,
    price_ngn: price,
    registration_id: null,
    join_token: null,
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
  // card and the gate can print it without a second query.
  const price =
    content.access_level === "purchase" && content.price_ngn != null
      ? Number(content.price_ngn)
      : null;

  if (content.access_level === "public") {
    return {
      can_view: true,
      reason: "public",
      preview_seconds: preview,
      price_ngn: price,
      registration_id: null,
      join_token: null,
    };
  }

  // Signed out, on any gated level. Not needs_purchase or needs_subscription —
  // this visitor may already own the thing. "Sign in and I'll tell you" is the
  // only honest answer, and it is correct for all four gated levels.
  if (userId === null) {
    return refuse("needs_signin", preview, price);
  }

  // Signed in, on a gated level. Until Prompt 12 adds the grant lookups there is
  // nothing that can say yes, so each level refuses with its own reason.
  //
  // These refuse rather than throw deliberately. Failing closed is the security
  // property that matters — a refusal cannot leak access — and there are already
  // real signed-in users (admins, instructors) browsing the public site today. A
  // throw would 500 the detail page for every one of them while protecting
  // nothing that this refusal doesn't already protect.
  switch (content.access_level) {
    case "registered":
      // TODO(prompt-12): grant on a confirmed registrations row. `waitlisted` and
      // `cancelled` must not grant access.
      return refuse("needs_registration", preview, price);

    case "subscriber":
      // TODO(prompt-12): grant on a subscriptions row in LIVE_STATUSES — import it
      // from routes/plans.ts rather than restating it, so the two cannot drift.
      return refuse("needs_subscription", preview, price);

    case "purchase":
      // TODO(prompt-12): grant on an entitlements row with expires_at null or future.
      return refuse("needs_purchase", preview, price);

    case "cohort":
      // TODO(prompt-12): grant on an entitlement with source='cohort'. Never
      // inferable from a subscription — cohort places are granted, not bought.
      return refuse("not_enrolled", preview, price);

    default:
      return refuse("unavailable");
  }
}
