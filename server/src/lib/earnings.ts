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
 * Scope: this only covers order_type-agnostic DIRECT CONTENT PURCHASES
 * (order.content_id set). Subscription revenue is explicitly out of scope —
 * EarningLine.attribution_basis has a "subscription_watch_share" value, which
 * would need to divide a subscriber's monthly payment across everything they
 * actually watched that period, weighted by watch_hours. Nothing in this
 * codebase computes that yet (no scheduled job infrastructure exists to run
 * a monthly reconciliation), so it is left as a stated, bounded gap rather
 * than approximated.
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
