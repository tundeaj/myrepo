import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

/**
 * Where Paystack's hosted checkout sends the browser back to. Paystack
 * appends `reference` (and `trxref`, the same value) to the callback URL —
 * this page's only job is to hand that to the server, which independently
 * re-verifies with Paystack rather than trusting the redirect itself.
 *
 * The redirect having happened is not proof of payment — see routes/checkout.ts.
 * This page is a courtesy: even if it never loaded (tab closed mid-payment),
 * the webhook already settles the order server-side.
 */

interface VerifyResponse {
  status: "paid" | "failed";
  order: { id: number; content_id: number | null; plan_id: number | null };
  access: { reason: string } | null;
  content: { slug: string; title: string } | null;
}

export function CheckoutCallback() {
  const [params] = useSearchParams();
  const { status: authStatus } = useAuth();
  const reference = params.get("reference") ?? params.get("trxref") ?? "";

  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Verification consumes a webhook-adjacent race (see finalizeOrder's
  // conditional update), but the GET itself is safe to repeat — guard against
  // StrictMode's double-effect firing it twice for no reason.
  const attempted = useRef(false);

  useEffect(() => {
    if (!reference || authStatus !== "signed-in" || attempted.current) return;
    attempted.current = true;

    api<VerifyResponse>(`/checkout/verify/${encodeURIComponent(reference)}`)
      .then(setResult)
      .catch((err) => setError(err?.message ?? "We couldn't confirm that payment."));
  }, [reference, authStatus]);

  if (authStatus === "loading") return <Shell><p className="text-sm text-slate-400">One moment…</p></Shell>;

  if (authStatus !== "signed-in") {
    return (
      <Shell>
        <p className="text-sm text-slate-400">
          Sign in to see your payment status.{" "}
          <Link to="/signin" className="text-white underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </Shell>
    );
  }

  if (!reference) {
    return (
      <Shell>
        <p className="text-sm text-slate-400">
          That link is missing a payment reference. If you just paid, check{" "}
          <Link to="/account/registrations" className="text-white underline-offset-4 hover:underline">
            your account
          </Link>{" "}
          — the payment may already have gone through.
        </p>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <p className="text-sm text-red-400">{error}</p>
        <p className="mt-2 text-xs text-slate-500">
          If money left your account, it will be confirmed shortly regardless — Paystack notifies us directly.
        </p>
      </Shell>
    );
  }

  if (!result) return <Shell><p className="text-sm text-slate-400">Confirming your payment…</p></Shell>;

  if (result.status === "failed") {
    return (
      <Shell>
        <p className="text-lg font-semibold text-slate-100">That payment didn't go through</p>
        <p className="mt-2 text-sm text-slate-400">Nothing was charged. You can try again.</p>
        <Link to="/" className="mt-6 inline-block rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900">
          Back to home
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-lg font-semibold text-slate-100">Payment confirmed</p>
      <p className="mt-2 text-sm text-slate-400">
        {result.order.content_id ? "You now have access to this." : "Your subscription is active."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        {result.content && (
          <Link
            to={`/watch/${result.content.slug}`}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900"
          >
            View it now
          </Link>
        )}
        <Link to="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">
          Back to home
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0f] px-6">
      <div className="max-w-sm text-center">{children}</div>
    </div>
  );
}
