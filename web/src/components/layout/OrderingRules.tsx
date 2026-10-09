import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../Toast";
import { EmptyState } from "../EmptyState";
import { ErrorState } from "../ErrorState";
import { Skeleton } from "../Skeleton";
import { Icon } from "../Icon";
import { inputClass, selectClass, Toggle } from "../session/Panel";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Rule {
  id: number;
  rule_key: string | null;
  description: string;
  condition_type: string | null;
  condition_value: number | null;
  promote_row_key: string | null;
  priority: number | null;
  is_enabled: boolean;
}

interface ConditionType {
  key: string;
  label: string;
  description: string;
  needsValue: boolean;
  valueLabel?: string;
}

interface RowOption {
  row_key: string | null;
  label: string | null;
}

interface SimResult {
  ordered: { id: number; row_key: string | null; label: string | null; row_type: string; display_order: number; promoted_by?: { rule_id: number; description: string } }[];
  fired: { id: number; description: string; condition_type: string | null; condition_value: number | null; promote_row_key: string | null }[];
}

// ─── Rule editor ───────────────────────────────────────────────────────────────

function RuleModal({
  rule,
  conditionTypes,
  rowOptions,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  conditionTypes: ConditionType[];
  rowOptions: RowOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(rule?.description ?? "");
  const [conditionType, setConditionType] = useState(rule?.condition_type ?? conditionTypes[0]?.key ?? "");
  const [conditionValue, setConditionValue] = useState(rule?.condition_value != null ? String(rule.condition_value) : "");
  const [promoteRowKey, setPromoteRowKey] = useState(rule?.promote_row_key ?? "");
  const [priority, setPriority] = useState(String(rule?.priority ?? 10));
  const [isEnabled, setIsEnabled] = useState(rule?.is_enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = conditionTypes.find((c) => c.key === conditionType);

  async function save() {
    setErr(null);
    if (!description.trim()) { setErr("Describe what this rule does and why. A rule nobody can explain is a rule nobody can debug."); return; }
    if (!promoteRowKey) { setErr("Pick the row this rule promotes."); return; }
    if (selected?.needsValue && !conditionValue.trim()) { setErr(`${selected.valueLabel ?? "Value"} is required for this condition.`); return; }

    setBusy(true);
    try {
      const payload = {
        description: description.trim(),
        condition_type: conditionType,
        condition_value: selected?.needsValue ? Number(conditionValue) : null,
        promote_row_key: promoteRowKey,
        priority: Number(priority) || 10,
        is_enabled: isEnabled,
      };
      if (rule) await api(`/layout/rules/${rule.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/layout/rules", { method: "POST", body: JSON.stringify(payload) });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save rule.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-sm font-semibold text-slate-100">{rule ? "Edit rule" : "Add ordering rule"}</h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">When…</label>
            <select value={conditionType} onChange={(e) => setConditionType(e.target.value)} className={selectClass}>
              {conditionTypes.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {selected && <p className="mt-1 text-xs text-slate-600">{selected.description}</p>}
          </div>

          {selected?.needsValue && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">{selected.valueLabel ?? "Value"}</label>
              <input type="number" value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} className={inputClass} />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">…promote this row to the top</label>
            <select value={promoteRowKey} onChange={(e) => setPromoteRowKey(e.target.value)} className={selectClass}>
              <option value="">Select a row…</option>
              {rowOptions.map((r) => <option key={r.row_key ?? ""} value={r.row_key ?? ""}>{r.label}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              placeholder="e.g. Put Live Now first whenever anything is streaming — a live session is the most time-sensitive thing on the page."
            />
            <p className="mt-1 text-xs text-slate-600">Required. Whoever inherits this page needs to know why the rule exists.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Priority</label>
            <input type="number" min={1} max={999} value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass} />
            <p className="mt-1 text-xs text-slate-600">Lower numbers are evaluated first; the highest-priority firing rule ends up on top.</p>
          </div>

          <Toggle label="Enabled" checked={isEnabled} onChange={setIsEnabled} />

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : rule ? "Save changes" : "Add rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rule simulator ────────────────────────────────────────────────────────────

const PRESETS: { key: string; label: string; state: Record<string, any> }[] = [
  { key: "logged_out", label: "Signed-out visitor", state: { logged_out: true, never_purchased: true } },
  { key: "live_now", label: "Something is live", state: { live_exists: true, never_purchased: false } },
  { key: "session_soon", label: "Session in 1 hour", state: { next_session_in_hours: 1, never_purchased: false } },
  { key: "mid_course", label: "80% through a course", state: { max_course_progress: 80, has_incomplete_progress: true, never_purchased: false } },
  { key: "lapsed", label: "Inactive 30 days", state: { days_inactive: 30, never_purchased: false } },
  { key: "browser", label: "Registered, never bought", state: { never_purchased: true } },
];

function RuleSimulator({ surface, platform }: { surface: string; platform: string }) {
  const [preset, setPreset] = useState(PRESETS[0].key);
  const [result, setResult] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async (presetKey: string) => {
    const p = PRESETS.find((x) => x.key === presetKey);
    if (!p) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api<SimResult>("/layout/rules/simulate", {
        method: "POST",
        body: JSON.stringify({ surface, platform, audience: p.state.logged_out ? "logged_out" : "registered", state: p.state }),
      });
      setResult(res);
    } catch (e: any) {
      setErr(e.message ?? "Simulation failed.");
    } finally {
      setBusy(false);
    }
  }, [surface, platform]);

  useEffect(() => { run(preset); }, [run, preset]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h3 className="text-sm font-semibold text-slate-100">Rule simulator</h3>
      <p className="mt-0.5 text-xs text-slate-500">Pick a viewer state and see the row order they'd actually get.</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
              preset === p.key ? "bg-brand text-white" : "border border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {busy ? (
          <div className="space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : err ? (
          <p className="text-sm text-red-400">{err}</p>
        ) : !result?.ordered.length ? (
          <p className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-600">
            No enabled rows on this surface to order yet.
          </p>
        ) : (
          <>
            <ol className="space-y-1.5">
              {result.ordered.map((row, i) => (
                <li
                  key={row.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                    row.promoted_by ? "border-brand/40 bg-brand/10" : "border-slate-800 bg-slate-950/60"
                  }`}
                >
                  <span className="w-5 flex-shrink-0 text-center text-xs tabular-nums text-slate-600">{i + 1}</span>
                  <span className="flex-1 truncate text-sm text-slate-200">{row.label}</span>
                  {row.promoted_by && (
                    <span className="flex-shrink-0 rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-medium text-brand">
                      Promoted
                    </span>
                  )}
                </li>
              ))}
            </ol>

            {result.fired.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
                <p className="text-xs font-medium text-slate-400">
                  {result.fired.length} rule{result.fired.length === 1 ? "" : "s"} fired
                </p>
                <ul className="mt-1.5 space-y-1">
                  {result.fired.map((f) => (
                    <li key={f.id} className="text-xs leading-snug text-slate-500">
                      <span className="text-brand">→</span> {f.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.fired.length === 0 && (
              <p className="mt-3 text-xs text-slate-600">No rules fired — viewers in this state see the default order above.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main tab ──────────────────────────────────────────────────────────────────

export function OrderingRules({ surface, platform, rowOptions }: { surface: string; platform: string; rowOptions: RowOption[] }) {
  const { toast } = useToast();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [conditionTypes, setConditionTypes] = useState<ConditionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [simKey, setSimKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ rules: Rule[] }>("/layout/rules"),
      api<{ condition_types: ConditionType[] }>("/layout/row-types"),
    ])
      .then(([r, t]) => { setRules(r.rules); setConditionTypes(t.condition_types); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load rules.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleRule(rule: Rule) {
    try {
      await api(`/layout/rules/${rule.id}`, { method: "PUT", body: JSON.stringify({ is_enabled: !rule.is_enabled }) });
      setRules((prev) => prev?.map((r) => (r.id === rule.id ? { ...r, is_enabled: !r.is_enabled } : r)) ?? null);
      setSimKey((k) => k + 1);
    } catch (e: any) {
      toast(e.message ?? "Failed to update rule.", "error");
    }
  }

  async function deleteRule(rule: Rule) {
    if (!confirm(`Delete this rule?\n\n"${rule.description}"`)) return;
    try {
      await api(`/layout/rules/${rule.id}`, { method: "DELETE" });
      setRules((prev) => prev?.filter((r) => r.id !== rule.id) ?? null);
      setSimKey((k) => k + 1);
      toast("Rule deleted.");
    } catch (e: any) {
      toast(e.message ?? "Failed to delete rule.", "error");
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {editing && (
        <RuleModal
          rule={editing === "new" ? null : editing}
          conditionTypes={conditionTypes}
          rowOptions={rowOptions}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); setSimKey((k) => k + 1); toast("Rule saved."); }}
        />
      )}

      {/* Rule list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Ordering rules</h3>
            <p className="text-xs text-slate-500">Evaluated in priority order for every viewer.</p>
          </div>
          <button onClick={() => setEditing("new")} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark">
            + Add rule
          </button>
        </div>

        {!rules?.length ? (
          <EmptyState
            icon={<Icon name="layout" className="h-6 w-6" />}
            heading="No ordering rules"
            explanation="Without rules, every viewer sees rows in the fixed order set on the Rows tab. Add a rule to react to what a viewer is doing."
            actionLabel="Add rule"
            onAction={() => setEditing("new")}
          />
        ) : (
          <ul className="space-y-2">
            {rules.map((rule) => (
              <li key={rule.id} className={`rounded-xl border border-slate-800 bg-slate-900/40 p-3 ${rule.is_enabled ? "" : "opacity-50"}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs tabular-nums text-slate-400">
                    {rule.priority}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug text-slate-200">{rule.description}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {conditionTypes.find((c) => c.key === rule.condition_type)?.label ?? rule.condition_type}
                      {rule.condition_value != null ? ` (${rule.condition_value})` : ""}
                      <span className="mx-1 text-slate-700">→</span>
                      promotes <span className="text-slate-500">{rowOptions.find((r) => r.row_key === rule.promote_row_key)?.label ?? rule.promote_row_key}</span>
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button onClick={() => toggleRule(rule)} className="relative">
                      <div className={`h-5 w-9 rounded-full transition-colors ${rule.is_enabled ? "bg-brand" : "bg-slate-700"}`} />
                      <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${rule.is_enabled ? "translate-x-4" : ""}`} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex justify-end gap-2 border-t border-slate-800/60 pt-2">
                  <button onClick={() => setEditing(rule)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200">Edit</button>
                  <button onClick={() => deleteRule(rule)} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-red-900/30 hover:text-red-400">Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Simulator */}
      <RuleSimulator key={simKey} surface={surface} platform={platform} />
    </div>
  );
}
