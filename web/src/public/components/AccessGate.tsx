import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";
import { formatPrice } from "../lib/types";

/**
 * The one place the access ladder becomes a button.
 *
 * Prompt 11 shipped this with every CTA inert, because there was nothing behind
 * them and nowhere honest to send anyone. Prompt 12 wires the two that now work:
 * signing in, and registering for free content. Purchase and subscription stay
 * inert until checkout lands — and still say so rather than pretending.
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

const PRIMARY =
  "inline-flex items-center justify-center rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-60";
const INERT =
  "inline-flex cursor-not-allowed items-center justify-center rounded-lg border border-slate-600 px-6 py-3 text-sm font-medium text-slate-300 opacity-80";

/** Still-unbuilt actions. Inert, and says why — a live-looking button that
 *  silently does nothing is worse than a disabled one with a sentence. */
function Pending({ label, note }: { label: string; note: string }) {
  return (
    <div className="space-y-2">
      <button type="button" disabled className={INERT}>
        {label}
      </button>
      <p className="max-w-sm text-xs text-slate-500">{note}</p>
    </div>
  );
}

export function AccessGate({
  access,
  isLive,
  contentId,
  onRegistered,
}: {
  access: AccessResult;
  isLive: boolean;
  contentId: number;
  /** Called with the refreshed access result so the page can re-render its gate
   *  without re-fetching the whole detail payload. */
  onRegistered?: (next: AccessResult) => void;
}) {
  const { status } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = formatPrice(access.price_ngn);
  // Returning here after signing in is the difference between a flow and a maze.
  const from = location.pathname + location.search;

  async function register() {
    setBusy(true);
    setError(null);
    try {
      await api("/registrations", {
        method: "POST",
        body: JSON.stringify({ content_id: contentId }),
      });
      const refreshed = await api<{ access: AccessResult }>(`/registrations/access/${contentId}`);
      onRegistered?.(refreshed.access);
    } catch (err: any) {
      setError(err?.message ?? "We couldn't register you. Try again.");
    } finally {
      setBusy(false);
    }
  }

  switch (access.reason) {
    // ── Access granted ───────────────────────────────────────────────────────
    case "public":
    case "registered":
    case "entitled":
    case "subscribed":
    case "cohort":
      return (
        <div className="space-y-2">
          <Pending
            label={isLive ? "Join live" : "Watch now"}
            note="You have access to this. The player itself is the next piece of the build."
          />
          {access.reason === "registered" && (
            <Link
              to="/account/registrations"
              className="inline-block text-xs text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
            >
              You're registered — manage your sessions
            </Link>
          )}
        </div>
      );

    // ── Signed out, on any gated level ───────────────────────────────────────
    case "needs_signin":
      return (
        <div className="space-y-2">
          <Link to="/signin" state={{ from }} className={PRIMARY}>
            {price ? `Sign in to buy · ${price}` : "Sign in to continue"}
          </Link>
          <p className="max-w-sm text-xs text-slate-500">
            {price ? (
              <>The price shown is final. Checkout is still being built.</>
            ) : (
              <>
                New here?{" "}
                <Link
                  to="/register"
                  state={{ from }}
                  className="text-slate-300 underline-offset-4 hover:underline"
                >
                  Create a free account
                </Link>
                .
              </>
            )}
          </p>
        </div>
      );

    // ── Signed in, free to register ──────────────────────────────────────────
    case "needs_registration":
      return (
        <div className="space-y-2">
          {status === "signed-in" ? (
            <>
              <button type="button" onClick={register} disabled={busy} className={PRIMARY}>
                {busy ? "Registering…" : "Register free"}
              </button>
              <p className="max-w-sm text-xs text-slate-500">
                Free to attend. We'll email you the joining details.
              </p>
              {error && <p className="max-w-sm text-xs text-red-400">{error}</p>}
            </>
          ) : (
            <Link to="/signin" state={{ from }} className={PRIMARY}>
              Sign in to register
            </Link>
          )}
        </div>
      );

    // ── Signed in, but it costs money — checkout lands in Prompt 13 ──────────
    case "needs_purchase":
      return (
        <Pending
          label={price ? `Buy · ${price}` : "Buy"}
          note="A one-time purchase, yours to rewatch. Checkout is being built."
        />
      );

    case "needs_subscription":
      return (
        <Pending
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
