import { prisma } from "./prisma.js";
import { getSetting } from "./settingValue.js";

/**
 * Revenue-share accrual: turns a paid Order into one EarningLine per speaker
 * credited on that content.
 *
 * Formula, and where it comes from:
 *   speaker's gross slice = order.amount_ngn × (ContentSpeaker.revenue_share_pct / 100)
 *
 * revenue_share_pct is how co-speakers split the "instructor side" of one
 * sale — SpeakersPanel.tsx (session/course builder) already validates that
 * every content item's speaker rows sum to 100%, so this reads that split
 * directly rather than re-deriving it. commission_pct — "Platform's default
 * share of revenue for new instructors" per its own settings copy
 * (monetisation.default_commission_pct) — is deducted per speaker, not
 * per-content, because it is an attribute of the SPEAKER (Speaker.commission_pct),
 * individually negotiable per instructor via Instructors → commission_pct.
 * WHT, if applicable, comes out of what's left after the platform's cut —
 * it is a tax on the instructor's income, not on the platform's share.
 *
 * Scope: this covers order_type-agnostic DIRECT CONTENT PURCHASES
 * (order.content_id set), run automatically the instant an order settles.
 * Subscription revenue (EarningLine.attribution_basis:
 * "subscription_watch_share") is a different shape of problem — see
 * computeSubscriptionAccrual()/runSubscriptionAccrual() below, and their own
 * module doc for why that one is a manually-triggered admin tool, not
 * something wired into checkout the way this is.
 */
export async function accrueEarnings(orderId: number): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || !order.content_id || order.amount_ngn == null) return;

  const speakers = await prisma.contentSpeaker.findMany({
    where: { content_id: order.content_id, revenue_share_pct: { gt: 0 } },
  });
  if (speakers.length === 0) return; // nothing to accrue — e.g. an in-house-only session

  // getNumberSetting() (settingValue.ts) treats 0 as "invalid, use the
  // fallback" — wrong here, since a holdback of 0 days ("pay out
  // immediately, no refund window") is a legitimate admin choice, not a
  // missing setting.
  const holdbackDays = parsePositiveOrZero(await getSetting("monetisation.payout_holdback_days"), 14);
  const holdbackUntil = holdbackDays > 0 ? new Date(Date.now() + holdbackDays * 86_400_000) : null;

  const grossOrder = Number(order.amount_ngn);
  const periodMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  await prisma.$transaction(
    speakers.map((cs) => {
      const sharePct = Number(cs.revenue_share_pct);
      const grossShare = Math.round(grossOrder * (sharePct / 100) * 100) / 100;
      return prisma.earningLine.create({
        data: {
          speaker_id: cs.speaker_id,
          content_id: order.content_id!,
          order_id: order.id,
          period_month: periodMonth,
          gross_ngn: grossShare,
          share_pct: sharePct,
          earned_ngn: grossShare,
          attribution_basis: "direct_sale",
          holdback_until: holdbackUntil,
          status: "accruing",
        },
      });
    }),
  );
}

function parsePositiveOrZero(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ─── Subscription revenue accrual ──────────────────────────────────────────
//
// Direct-sale accrual above has an unambiguous source of truth: one Order,
// one amount, one moment it settles. Subscription revenue has neither.
//
// This app has no per-period renewal billing record — checkout.ts creates a
// Subscription row once, at first purchase, and nothing since has ever
// created a follow-up Order (or ingested a Paystack recurring-charge
// webhook) for a renewal. So "what did this subscriber actually pay this
// month" isn't data this app has; the closest honest stand-in is the plan's
// CURRENT price (an annual plan's price divided by 12, so a whole year's
// revenue doesn't land in one calendar month). A subscriber who changed
// plans mid-period, or was given a one-off discount, won't be reflected
// precisely. Stated, not hidden.
//
// The other real policy question — how much watching should count at all —
// is exposed as an admin setting (monetisation.subscription_min_watch_seconds)
// rather than a number picked here. And the whole feature is OFF by default
// (monetisation.subscription_accrual_enabled) — nothing runs, preview or
// real, until an admin has read the caveat above and turned it on.
//
// Execution is a manually-triggered admin action (routes/payouts.ts), not
// an automatic monthly job — this app has no scheduler to run one, and
// building a fake "looks automatic" cron with no actual infrastructure
// behind it would be worse than an honest button. computeSubscriptionAccrual
// is the read-only preview; runSubscriptionAccrual is the same computation
// followed by actually writing EarningLine rows. Both use the same function
// so a preview can never show numbers the real run would compute differently
// — the same discipline routes/payouts.ts already applies to direct-sale
// payout runs.

export interface SubscriptionAccrualContentShare {
  content_id: number;
  title: string | null;
  watch_seconds: number;
  share_of_period_amount_ngn: number;
  /** True if an EarningLine already exists for this exact (subscription,
   *  content, period) combination — re-running the real accrual will skip
   *  it rather than create a duplicate. */
  already_accrued: boolean;
}

export interface SubscriptionAccrualSubscriber {
  subscription_id: number;
  user_id: number;
  plan_name: string | null;
  period_amount_ngn: number;
  content: SubscriptionAccrualContentShare[];
}

function monthBounds(periodMonth: string): { start: Date; end: Date } {
  const [year, month] = periodMonth.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Invalid period_month "${periodMonth}" — expected "YYYY-MM".`);
  }
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

function planPeriodAmount(plan: { price_ngn: unknown; billing_interval: string }): number {
  const price = plan.price_ngn != null ? Number(plan.price_ngn) : 0;
  return plan.billing_interval === "annual" ? Math.round((price / 12) * 100) / 100 : price;
}

/** Read-only: computes exactly what runSubscriptionAccrual() would write,
 *  without writing it. Shared by GET /payouts/subscription-accrual-preview
 *  and the real POST run. */
export async function computeSubscriptionAccrual(periodMonth: string): Promise<SubscriptionAccrualSubscriber[]> {
  const { start, end } = monthBounds(periodMonth);
  const minWatchSeconds = parsePositiveOrZero(await getSetting("monetisation.subscription_min_watch_seconds"), 60);

  // A subscription that existed at any point before the period closed —
  // this doesn't try to prorate a subscriber who joined or cancelled
  // mid-period against days-active; watch time itself is the real gate on
  // whether they earned anything, and someone who cancelled before ever
  // watching a qualifying amount contributes nothing either way.
  const subscriptions = await prisma.subscription.findMany({
    where: { created_at: { lt: end }, status: { in: ["active", "past_due", "paused", "cancelled", "expired"] } },
  });
  if (subscriptions.length === 0) return [];

  const planIds = [...new Set(subscriptions.map((s) => s.plan_id))];
  const plans = await prisma.plan.findMany({ where: { id: { in: planIds } } });
  const planById = new Map(plans.map((p) => [p.id, p]));

  const results: SubscriptionAccrualSubscriber[] = [];

  for (const sub of subscriptions) {
    const plan = planById.get(sub.plan_id);
    if (!plan) continue;
    const periodAmount = planPeriodAmount(plan);
    if (periodAmount <= 0) continue;

    const sessions = await prisma.playbackSession.findMany({
      where: { user_id: sub.user_id, content_id: { not: null }, started_at: { gte: start, lt: end } },
      select: { content_id: true, watch_seconds: true },
    });
    if (sessions.length === 0) continue;

    const watchByContent = new Map<number, number>();
    for (const s of sessions) {
      watchByContent.set(s.content_id!, (watchByContent.get(s.content_id!) ?? 0) + s.watch_seconds);
    }

    // Only subscriber-tier content is subscription revenue's to claim — a
    // subscriber who ALSO separately bought something, or watched a public
    // preview, has that counted (or not) by the direct-sale path instead.
    const contentItems = await prisma.contentItem.findMany({
      where: { id: { in: [...watchByContent.keys()] }, access_level: "subscriber" },
      select: { id: true, title: true },
    });
    const qualifying = contentItems
      .map((c) => ({ content_id: c.id, title: c.title, watch_seconds: watchByContent.get(c.id)! }))
      .filter((c) => c.watch_seconds >= minWatchSeconds);
    if (qualifying.length === 0) continue;

    const existingLines = await prisma.earningLine.findMany({
      where: {
        subscription_id: sub.id,
        period_month: periodMonth,
        attribution_basis: "subscription_watch_share",
        content_id: { in: qualifying.map((c) => c.content_id) },
      },
      select: { content_id: true },
    });
    const alreadyAccrued = new Set(existingLines.map((l) => l.content_id));

    const totalWatchSeconds = qualifying.reduce((sum, c) => sum + c.watch_seconds, 0);

    results.push({
      subscription_id: sub.id,
      user_id: sub.user_id,
      plan_name: plan.name,
      period_amount_ngn: periodAmount,
      content: qualifying.map((c) => ({
        content_id: c.content_id,
        title: c.title,
        watch_seconds: c.watch_seconds,
        share_of_period_amount_ngn: Math.round(periodAmount * (c.watch_seconds / totalWatchSeconds) * 100) / 100,
        already_accrued: alreadyAccrued.has(c.content_id),
      })),
    });
  }

  return results;
}

export interface SubscriptionAccrualResult {
  created: number;
  skipped_already_accrued: number;
  skipped_no_credited_speakers: number;
  total_ngn: number;
}

/** The real run. Same holdback policy as direct-sale accrual, same
 *  per-speaker revenue_share_pct split, same EarningLine.status: 'accruing'
 *  starting point — subscription earnings join the exact same holdback →
 *  payable → payout pipeline direct sales already use, just tagged with a
 *  different attribution_basis and a subscription_id instead of order_id. */
export async function runSubscriptionAccrual(periodMonth: string): Promise<SubscriptionAccrualResult> {
  const preview = await computeSubscriptionAccrual(periodMonth);

  const holdbackDays = parsePositiveOrZero(await getSetting("monetisation.payout_holdback_days"), 14);
  const holdbackUntil = holdbackDays > 0 ? new Date(Date.now() + holdbackDays * 86_400_000) : null;

  const result: SubscriptionAccrualResult = { created: 0, skipped_already_accrued: 0, skipped_no_credited_speakers: 0, total_ngn: 0 };

  for (const sub of preview) {
    for (const c of sub.content) {
      if (c.already_accrued) {
        result.skipped_already_accrued++;
        continue;
      }

      const speakers = await prisma.contentSpeaker.findMany({
        where: { content_id: c.content_id, revenue_share_pct: { gt: 0 } },
      });
      if (speakers.length === 0) {
        result.skipped_no_credited_speakers++;
        continue;
      }

      await prisma.$transaction(
        speakers.map((cs) => {
          const sharePct = Number(cs.revenue_share_pct);
          const grossShare = Math.round(c.share_of_period_amount_ngn * (sharePct / 100) * 100) / 100;
          return prisma.earningLine.create({
            data: {
              speaker_id: cs.speaker_id,
              content_id: c.content_id,
              subscription_id: sub.subscription_id,
              period_month: periodMonth,
              gross_ngn: grossShare,
              share_pct: sharePct,
              earned_ngn: grossShare,
              attribution_basis: "subscription_watch_share",
              watch_hours: Math.round((c.watch_seconds / 3600) * 100) / 100,
              holdback_until: holdbackUntil,
              status: "accruing",
            },
          });
        }),
      );

      result.created++;
      result.total_ngn = Math.round((result.total_ngn + c.share_of_period_amount_ngn) * 100) / 100;
    }
  }

  return result;
}
