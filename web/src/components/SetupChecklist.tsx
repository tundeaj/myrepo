import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./Skeleton";
import { Icon } from "./Icon";

interface SetupStep {
  id: number;
  step_key: string;
  label: string;
  description: string;
  status: "pending" | "in_progress" | "complete" | "skipped";
  config_route: string;
}

const STEP_ICONS: Record<string, string> = {
  video_provider: "video",
  email_smtp: "mail",
  payments: "credit",
  plans: "wallet",
  branding: "layout",
  first_speaker: "mic",
  first_session: "video",
  reminders: "bell",
  categories: "folder",
  first_content: "upload",
};

/** Reusable across /admin (category="platform") and /instructor (category="instructor").
 *  Pass `steps` to skip the admin-gated fetch (the instructor portal supplies its own). */
export function SetupChecklist({ category, steps: providedSteps }: { category: "platform" | "instructor"; steps?: SetupStep[] }) {
  const { data, loading: fetchLoading, error: fetchError, retry } = useApi<{ steps: SetupStep[] }>(
    providedSteps ? null : `/dashboard/setup-steps?category=${category}`,
  );
  const loading = providedSteps ? false : fetchLoading;
  const error = providedSteps ? null : fetchError;
  const storageKey = `webinarflix.setup-checklist.${category}.collapsed`;
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(storageKey) === "true");

  useEffect(() => {
    localStorage.setItem(storageKey, String(collapsed));
  }, [collapsed, storageKey]);

  const steps = providedSteps ?? data?.steps ?? [];
  const total = steps.length;
  const done = steps.filter((s) => s.status === "complete").length;
  const allDone = total > 0 && done === total;
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <Skeleton className="h-5 w-48" />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={retry} />;
  }

  if (total === 0) return null;

  if (allDone && collapsed !== false) {
    // Auto-collapse with a green banner once everything is complete.
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center gap-3 rounded-xl border border-emerald-800/40 bg-emerald-950/30 px-5 py-3 text-left hover:bg-emerald-950/50"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">✓</span>
        <span className="text-sm font-medium text-emerald-200">All set — your platform is ready to go live.</span>
        <span className="ml-auto text-xs text-emerald-400/70">Review setup</span>
      </button>
    );
  }

  const circumference = 2 * Math.PI * 18;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <button onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center gap-4 text-left">
        <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0 -rotate-90">
          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-800" />
          <circle
            cx="22"
            cy="22"
            r="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            className="text-brand"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (pct / 100) * circumference}
          />
        </svg>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-100">Setup checklist</h2>
          <p className="text-xs text-slate-500">
            {done} of {total} steps complete
          </p>
        </div>
        <Icon name="chevron" className={`h-4 w-4 text-slate-500 transition-transform ${collapsed ? "" : "rotate-90"}`} />
      </button>

      {!collapsed && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, i) => (
            <div key={step.step_key} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-400">
                  {i + 1}
                </span>
                <Icon name={STEP_ICONS[step.step_key] ?? "grid"} className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">{step.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{step.description}</p>
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    step.status === "complete" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {step.status === "complete" ? "Complete" : "Pending"}
                </span>
                <Link to={step.config_route} className="text-xs font-medium text-brand hover:underline">
                  {step.status === "complete" ? "Reconfigure" : "Configure"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
