import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";

interface ModuleRow {
  flag_key: string;
  label: string | null;
  description: string | null;
  tier: "core" | "growth" | "enterprise";
  is_enabled: boolean;
}

interface TierGroup {
  tier: "core" | "growth" | "enterprise";
  modules: ModuleRow[];
}

const TIER_LABELS: Record<TierGroup["tier"], string> = { core: "Core", growth: "Growth", enterprise: "Enterprise" };
const TIER_STYLES: Record<TierGroup["tier"], string> = {
  core: "bg-slate-800 text-slate-300",
  growth: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  enterprise: "bg-purple-500/15 text-purple-300 border border-purple-500/30",
};

export function Modules() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<TierGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ groups: TierGroup[] }>("/modules")
      .then((res) => { setGroups(res.groups); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load modules.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(mod: ModuleRow) {
    const verb = mod.is_enabled ? "turn off" : "turn on";
    if (mod.is_enabled && !confirm(`Turn off "${mod.label}"? This hides it from users immediately. Existing data is preserved.`)) return;
    setTogglingKey(mod.flag_key);
    try {
      await api(`/modules/${mod.flag_key}`, { method: "PUT", body: JSON.stringify({ is_enabled: !mod.is_enabled }) });
      setGroups((prev) =>
        prev?.map((g) => ({ ...g, modules: g.modules.map((m) => (m.flag_key === mod.flag_key ? { ...m, is_enabled: !m.is_enabled } : m)) })) ?? null,
      );
      toast(`${mod.label} turned ${mod.is_enabled ? "off" : "on"}.`);
    } catch (e: any) {
      toast(e.message ?? `Failed to ${verb} this module.`, "error");
    } finally {
      setTogglingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Modules</h1>
        <p className="mt-1 text-sm text-slate-500">
          Turning a feature off hides it from users immediately. Existing data is preserved.
        </p>
      </div>

      {groups?.map((group) => (
        <div key={group.tier}>
          <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {TIER_LABELS[group.tier]}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium normal-case ${TIER_STYLES[group.tier]}`}>{group.modules.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.modules.map((mod) => (
              <div key={mod.flag_key} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">{mod.label}</p>
                    {mod.description && <p className="mt-1 text-xs text-slate-500">{mod.description}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(mod)}
                    disabled={togglingKey === mod.flag_key}
                    className="relative mt-0.5 flex-shrink-0 disabled:opacity-50"
                  >
                    <div className={`h-5 w-9 rounded-full transition-colors ${mod.is_enabled ? "bg-brand" : "bg-slate-700"}`} />
                    <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${mod.is_enabled ? "translate-x-4" : ""}`} />
                  </button>
                </div>
                <span className={`mt-3 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TIER_STYLES[group.tier]}`}>
                  {TIER_LABELS[group.tier]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
