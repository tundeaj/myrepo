import { useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import {
  usePublicData,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";
import { formatPrice } from "./lib/types";

interface Plan {
  id: number;
  name: string | null;
  price_ngn: number | null;
  billing_interval: "monthly" | "annual";
  features: string | null;
  is_team_plan: boolean;
  seat_count: number;
  max_concurrent_streams: number;
}

interface PlansPayload extends PublicBootstrap {
  plans: Plan[];
}

function parseFeatures(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}

function PlanCard({ plan }: { plan: Plan }) {
  const { status } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = formatPrice(plan.price_ngn);
  const features = parseFeatures(plan.features);

  async function subscribe() {
    if (status !== "signed-in") {
      window.location.href = `/signin?from=${encodeURIComponent("/plans")}`;
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ free: boolean; authorization_url?: string }>("/checkout/session", {
        method: "POST",
        body: JSON.stringify({ plan_id: plan.id }),
      });
      if (res.authorization_url) window.location.href = res.authorization_url;
    } catch (err: any) {
      setError(err?.message ?? "We couldn't start checkout. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="text-lg font-semibold text-slate-100">{plan.name ?? "Plan"}</h2>
      <p className="mt-2">
        <span className="text-3xl font-bold text-white">{price ?? "Free"}</span>
        {price && (
          <span className="text-sm text-slate-500">
            {" "}
            / {plan.billing_interval === "annual" ? "year" : "month"}
          </span>
        )}
      </p>
      {plan.is_team_plan && (
        <p className="mt-1 text-xs text-slate-500">
          {plan.seat_count} seats · {plan.max_concurrent_streams} concurrent streams
        </p>
      )}

      {features.length > 0 && (
        <ul className="mt-5 flex-1 space-y-2">
          {features.map((f, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-300">
              <span className="mt-0.5 text-emerald-400">✓</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={subscribe}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Starting checkout…" : "Subscribe"}
      </button>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Plans() {
  const { data, error, loading, retry } = usePublicData<PlansPayload>("/api/public-plans");

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-5xl px-6 pb-16 pt-24">
        <h1 className="text-2xl font-bold text-white">Plans</h1>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          Subscribe for full access to everything marked "Included with a subscription".
        </p>

        {!data.plans.length ? (
          <p className="mt-10 text-sm text-slate-500">No plans are available right now.</p>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.plans.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}
