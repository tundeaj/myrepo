import { formatPrice } from "../lib/types";

/**
 * The one place the access ladder becomes a button.
 *
 * ⚠️ Every CTA here is currently inert, and says so. Nothing in this build can
 * actually be watched, registered for or bought: the player lands in Prompt 13
 * and accounts, registration and checkout in Prompt 12. There is also nowhere
 * honest to send someone — /signin doesn't exist yet, and /login redirects into
 * the admin console, which is wrong for a viewer.
 *
 * A button that looks live and silently does nothing is worse than a disabled
 * one with a sentence explaining why. When Prompt 12 lands, each state below
 * swaps its inert control for the real action and the note goes away.
 *
 * All eleven states are reachable today: the signed-out ones through the gated
 * levels, and the four "needs" states for any signed-in user, because
 * resolveAccess fails closed until the grant lookups exist.
 */

export type AccessReason =
  | "public"
  | "registered"
  | "entitled"
  | "subscribed"
  | "cohort"
  | "needs_signin"
  | "needs_registration"
  | "needs_purchase"
  | "needs_subscription"
  | "not_enrolled"
  | "unavailable";

export interface AccessResult {
  can_view: boolean;
  reason: AccessReason;
  preview_seconds: number;
  price_ngn: number | null;
  registration_id: number | null;
  join_token: string | null;
}

/** Inert control plus the reason it's inert. One shape for every state, so no
 *  state can accidentally look more live than another. */
function Pending({
  label,
  note,
  emphasis = false,
}: {
  label: string;
  note: string;
  emphasis?: boolean;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled
        className={
          emphasis
            ? "inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-white/90 px-6 py-3 text-sm font-semibold text-slate-900 opacity-80"
            : "inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-slate-600 px-6 py-3 text-sm font-medium text-slate-300 opacity-80"
        }
      >
        {label}
      </button>
      <p className="max-w-sm text-xs text-slate-500">{note}</p>
    </div>
  );
}

export function AccessGate({ access, isLive }: { access: AccessResult; isLive: boolean }) {
  const price = formatPrice(access.price_ngn);

  switch (access.reason) {
    // ── Access granted: only `public` is reachable without an account ─────────
    case "public":
    case "registered":
    case "entitled":
    case "subscribed":
    case "cohort":
      return (
        <Pending
          emphasis
          label={isLive ? "Join live" : "Watch now"}
          note="You have access to this. The player itself is the next piece of the build."
        />
      );

    // ── Signed out, on any gated level ───────────────────────────────────────
    case "needs_signin":
      return (
        <Pending
          emphasis
          label={price ? `Sign in to buy · ${price}` : "Sign in to continue"}
          note={
            price
              ? "Accounts and checkout are being built. The price shown is final."
              : "Accounts are being built. Anything marked public is open to everyone in the meantime."
          }
        />
      );

    // ── Signed in, but nothing grants access yet ─────────────────────────────
    case "needs_registration":
      return (
        <Pending
          emphasis
          label="Register free"
          note="Free to attend. Registration opens when accounts land in the next build."
        />
      );

    case "needs_purchase":
      return (
        <Pending
          emphasis
          label={price ? `Buy · ${price}` : "Buy"}
          note="A one-time purchase, yours to rewatch. Checkout is being built."
        />
      );

    case "needs_subscription":
      return (
        <Pending
          emphasis
          label="Included with a subscription"
          note="Plans and subscriptions are being built."
        />
      );

    case "not_enrolled":
      return (
        <Pending
          label="Cohort programme"
          note="This runs as a cohort with a fixed start date. Places are granted rather than bought — get in touch to join the next intake."
        />
      );

    case "unavailable":
    default:
      return <Pending label="Not available" note="This has expired or been withdrawn." />;
  }
}
