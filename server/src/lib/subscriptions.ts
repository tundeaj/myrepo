/**
 * The one place a subscription's period end gets computed.
 *
 * Pulled out because two callers need it — the self-serve checkout below and
 * the corporate-invoice confirmation in routes/invoices.ts — and the invoice
 * path previously hardcoded +1 month regardless of the plan's actual
 * billing_interval. An annual plan paid via invoice was granted a one-month
 * period, silently. Fixed here rather than left in place next to new code
 * that gets it right.
 */
export function computePeriodEnd(billingInterval: "monthly" | "annual", from: Date = new Date()): Date {
  const end = new Date(from);
  if (billingInterval === "annual") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}
