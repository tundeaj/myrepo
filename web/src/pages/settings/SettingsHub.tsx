import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Toggle, inputClass, selectClass } from "../../components/session/Panel";

// ─── Types (mirror server/src/lib/settingsSchema.ts) ──────────────────────────

type SettingControl = "text" | "textarea" | "toggle" | "select" | "color" | "chips" | "number" | "secret" | "image" | "timezone";

interface FieldValue {
  key: string;
  label: string;
  helper: string;
  control: SettingControl;
  options?: { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  value?: string;
  default?: string;
  is_default?: boolean;
  is_set?: boolean; // secret only
}

interface Group {
  key: string;
  label: string;
  fields: FieldValue[];
}

interface GetResponse {
  groups: Group[];
  timezones: string[];
}

// ─── Chips input ───────────────────────────────────────────────────────────────

function ChipsInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const chips = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const [draft, setDraft] = useState("");

  function commit() {
    const v = draft.trim();
    if (!v) return;
    if (!chips.includes(v)) onChange([...chips, v].join(","));
    setDraft("");
  }

  function removeChip(chip: string) {
    onChange(chips.filter((c) => c !== chip).join(","));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-800 bg-slate-950 p-2">
        {chips.map((c) => (
          <span key={c} className="flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-200">
            {c}
            <button type="button" onClick={() => removeChip(c)} className="text-slate-500 hover:text-red-400">×</button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
            else if (e.key === "Backspace" && !draft && chips.length) removeChip(chips[chips.length - 1]);
          }}
          onBlur={commit}
          placeholder={chips.length ? "" : placeholder ?? "Type and press Enter…"}
          className="min-w-[100px] flex-1 bg-transparent px-1 py-0.5 text-sm text-slate-100 focus:outline-none"
        />
      </div>
    </div>
  );
}

// ─── Secret field ───────────────────────────────────────────────────────────────

function SecretField({ field, draft, onChange }: { field: FieldValue; draft: string | undefined; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <span className={`flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm ${field.is_set ? "text-slate-300" : "text-slate-600"}`}>
          {field.is_set ? "•••••••••••••••• (value set)" : "Not set"}
        </span>
        <button type="button" onClick={() => setEditing(true)} className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <input
        type="password"
        autoFocus
        value={draft ?? ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Enter new value…"
        className={inputClass + " flex-1"}
      />
      <button type="button" onClick={() => { setEditing(false); onChange(""); }} className="flex-shrink-0 text-xs text-slate-500 hover:text-slate-300">
        Cancel
      </button>
    </div>
  );
}

// ─── Field renderer ─────────────────────────────────────────────────────────────

function SettingRow({
  field,
  draftValue,
  onChange,
  onReset,
  timezones,
}: {
  field: FieldValue;
  draftValue: string | undefined;
  onChange: (key: string, value: string) => void;
  onReset: (key: string) => void;
  timezones: string[];
}) {
  const currentValue = draftValue !== undefined ? draftValue : (field.value ?? "");
  const isFontField = field.key === "brand.font_family";
  const isCustomFont = isFontField && currentValue && currentValue !== field.default;

  return (
    <div className="flex flex-col gap-2 border-b border-slate-800/60 py-4 last:border-0 sm:flex-row sm:items-start sm:gap-6">
      <div className="sm:w-64 sm:flex-shrink-0">
        <p className="text-sm font-medium text-slate-200">{field.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{field.helper}</p>
      </div>
      <div className="flex-1 sm:max-w-md">
        {field.control === "toggle" && (
          <Toggle label="" checked={currentValue === "true"} onChange={(v) => onChange(field.key, String(v))} />
        )}

        {field.control === "text" && (
          <input type="text" value={currentValue} onChange={(e) => onChange(field.key, e.target.value)} placeholder={field.placeholder} className={inputClass} />
        )}

        {field.control === "textarea" && (
          <textarea rows={4} value={currentValue} onChange={(e) => onChange(field.key, e.target.value)} className={inputClass} />
        )}

        {field.control === "number" && (
          <input type="number" min={field.min} max={field.max} value={currentValue} onChange={(e) => onChange(field.key, e.target.value)} className={inputClass} />
        )}

        {field.control === "color" && (
          <div className="flex items-center gap-2">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(currentValue) ? currentValue : "#000000"} onChange={(e) => onChange(field.key, e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-800 bg-slate-950" />
            <input type="text" value={currentValue} onChange={(e) => onChange(field.key, e.target.value)} className={inputClass + " flex-1"} />
          </div>
        )}

        {field.control === "select" && (
          <select value={currentValue} onChange={(e) => onChange(field.key, e.target.value)} className={selectClass}>
            {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}

        {field.control === "timezone" && (
          <select value={currentValue} onChange={(e) => onChange(field.key, e.target.value)} className={selectClass}>
            {timezones.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        )}

        {field.control === "chips" && (
          <ChipsInput value={currentValue} onChange={(v) => onChange(field.key, v)} />
        )}

        {field.control === "image" && (
          <div className="flex items-center gap-3">
            {currentValue && <img src={currentValue} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover border border-slate-800" />}
            <input type="text" value={currentValue} onChange={(e) => onChange(field.key, e.target.value)} placeholder="Image URL" className={inputClass + " flex-1"} />
          </div>
        )}

        {field.control === "secret" && (
          <SecretField field={field} draft={draftValue} onChange={(v) => onChange(field.key, v)} />
        )}

        {isCustomFont && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <span>⚠</span>
            <span>Custom fonts slow load on 2G/3G. Self-host if possible.</span>
          </p>
        )}

        {field.control !== "secret" && field.is_default === false && (
          <button type="button" onClick={() => onReset(field.key)} className="mt-1.5 text-xs text-brand hover:underline">
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Group panels needing a "Test" action ──────────────────────────────────────

function TestConnectionRow({ provider, label }: { provider: "bunny" | "imagekit" | "paystack"; label: string }) {
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api<{ ok: boolean; message: string }>("/settings/test-connection", {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
      setStatus(res);
    } catch (e: any) {
      setStatus({ ok: false, message: e.message ?? "Test failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-t border-slate-800/60 py-3">
      <button type="button" onClick={test} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
        {busy ? "Testing…" : `Test ${label} connection`}
      </button>
      {status && (
        <span className={`text-xs font-medium ${status.ok ? "text-emerald-400" : "text-red-400"}`}>
          {status.ok ? "✓" : "✕"} {status.message}
        </span>
      )}
    </div>
  );
}

function TestEmailRow() {
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api<{ ok: boolean; message: string }>("/settings/test-email", { method: "POST" });
      setStatus(res);
    } catch (e: any) {
      setStatus({ ok: false, message: e.message ?? "Failed to send." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 border-t border-slate-800/60 py-3">
      <button type="button" onClick={send} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
        {busy ? "Sending…" : "Send test email"}
      </button>
      {status && (
        <span className={`text-xs font-medium ${status.ok ? "text-emerald-400" : "text-red-400"}`}>
          {status.ok ? "✓" : "✕"} {status.message}
        </span>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

const GROUP_META = [
  { key: "brand", label: "Brand" },
  { key: "localisation", label: "Localisation" },
  { key: "registration", label: "Registration & Access" },
  { key: "playback", label: "Playback & Delivery" },
  { key: "monetisation", label: "Monetisation" },
  { key: "content_policy", label: "Content Policy" },
  { key: "notifications", label: "Notifications & Email" },
  { key: "integrations", label: "Integrations" },
  { key: "instructor", label: "Instructor & Partner" },
];

export function SettingsHub() {
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeGroup = searchParams.get("group") || "brand";

  const [data, setData] = useState<GetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [resets, setResets] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<GetResponse>("/settings")
      .then((res) => { setData(res); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load settings.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Landing spot after a meeting-provider OAuth connection completes
  // (routes/providerConnections.ts's callback redirects here) — surface
  // what happened, then drop the query params so a refresh doesn't re-toast.
  useEffect(() => {
    const connected = searchParams.get("connected");
    const connectionError = searchParams.get("connection_error");
    if (!connected && !connectionError) return;
    if (connected) toast(`${connected.replace("_", " ")} account connected.`);
    if (connectionError) toast(connectionError, "error");
    const next = new URLSearchParams(searchParams);
    next.delete("connected");
    next.delete("connection_error");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const group = data?.groups.find((g) => g.key === activeGroup);
  const isDirty = Object.keys(drafts).some((k) => group?.fields.some((f) => f.key === k)) || resets.size > 0;

  function handleChange(key: string, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }));
    setResets((r) => { const n = new Set(r); n.delete(key); return n; });
  }

  function handleReset(key: string) {
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    setResets((r) => new Set(r).add(key));
  }

  async function handleSave() {
    if (!group) return;
    const values: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(drafts)) {
      if (group.fields.some((f) => f.key === key)) {
        const field = group.fields.find((f) => f.key === key)!;
        if (field.control === "secret" && !value.trim()) continue; // unchanged
        values[key] = value;
      }
    }
    for (const key of resets) {
      if (group.fields.some((f) => f.key === key)) values[key] = null;
    }
    if (!Object.keys(values).length) return;

    setSaving(true);
    try {
      await api(`/settings/${activeGroup}`, { method: "PUT", body: JSON.stringify({ values }) });
      toast(`${GROUP_META.find((g) => g.key === activeGroup)?.label ?? "Settings"} saved.`);
      setDrafts({});
      setResets(new Set());
      load();
    } catch (e: any) {
      toast(e.message ?? "Failed to save settings.", "error");
    } finally {
      setSaving(false);
    }
  }

  function switchGroup(key: string) {
    if (isDirty && !confirm("You have unsaved changes. Discard them?")) return;
    setDrafts({});
    setResets(new Set());
    setSearchParams({ group: key });
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      {/* Left sub-nav */}
      <nav className="flex flex-shrink-0 gap-1 overflow-x-auto pb-2 lg:w-52 lg:flex-col lg:overflow-visible lg:pb-0">
        {GROUP_META.map((g) => (
          <button
            key={g.key}
            onClick={() => switchGroup(g.key)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              activeGroup === g.key ? "bg-brand/15 font-medium text-brand" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            {g.label}
          </button>
        ))}
      </nav>

      {/* Right pane */}
      <div className="min-w-0 flex-1">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : error ? (
          <ErrorState message={error} correlationId={correlationId} onRetry={load} />
        ) : !group ? (
          <p className="text-sm text-slate-500">Unknown settings group.</p>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/40">
            {/* Sticky save bar */}
            <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b border-slate-800 bg-slate-900/95 px-5 py-3 backdrop-blur">
              <h2 className="text-sm font-semibold text-slate-100">{group.label}</h2>
              <div className="flex items-center gap-3">
                {isDirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
                <button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  className="rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            <div className="px-5">
              {activeGroup === "content_policy" && (
                <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-500">
                  ℹ️ Ads serve only on Public and Registered content.
                </p>
              )}

              {group.fields.map((field) => (
                <SettingRow
                  key={field.key}
                  field={field}
                  draftValue={drafts[field.key]}
                  onChange={handleChange}
                  onReset={handleReset}
                  timezones={data?.timezones ?? []}
                />
              ))}

              {activeGroup === "notifications" && <TestEmailRow />}
              {activeGroup === "integrations" && (
                <>
                  <TestConnectionRow provider="bunny" label="Bunny Stream" />
                  <TestConnectionRow provider="imagekit" label="ImageKit" />
                  <TestConnectionRow provider="paystack" label="Paystack" />
                </>
              )}
            </div>
            <div className="h-2" />
          </div>
        )}
      </div>
    </div>
  );
}
