import { useState } from "react";
import { api } from "../../lib/api";
import { inputClass, selectClass, Toggle } from "../session/Panel";

export interface RowTypeDef {
  key: string;
  label: string;
  description: string;
  personal: boolean;
  defaultCardStyle: string;
  params?: { key: string; label: string; type: "number" | "text" }[];
}

export interface ContentRow {
  id: number;
  row_key: string | null;
  label: string | null;
  label_fr: string | null;
  row_type: string;
  surface: string | null;
  platform: string;
  audience: string;
  params: string | null;
  card_limit: number;
  display_order: number;
  is_enabled: boolean;
  hide_when_empty: boolean;
  card_style: string;
}

const AUDIENCES = [
  { value: "all", label: "Everyone" },
  { value: "logged_out", label: "Signed-out visitors" },
  { value: "registered", label: "Registered users" },
  { value: "subscriber", label: "Subscribers" },
  { value: "enrolled", label: "Enrolled learners" },
];

const CARD_STYLES = [
  { value: "poster", label: "Poster (2:3)" },
  { value: "landscape", label: "Landscape (16:9)" },
  { value: "numbered", label: "Numbered" },
  { value: "tile", label: "Category tile" },
  { value: "speaker", label: "Speaker" },
];

const PLATFORMS = [
  { value: "all", label: "Web and mobile" },
  { value: "web", label: "Web only" },
  { value: "mobile", label: "Mobile only" },
];

interface Props {
  row: ContentRow | null;
  surface: string;
  rowTypes: RowTypeDef[];
  onClose: () => void;
  onSaved: () => void;
}

export function RowSlideOver({ row, surface, rowTypes, onClose, onSaved }: Props) {
  const isEdit = Boolean(row);
  let initialParams: Record<string, string> = {};
  if (row?.params) {
    try {
      const parsed = JSON.parse(row.params);
      initialParams = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
    } catch { initialParams = {}; }
  }

  const [rowType, setRowType] = useState(row?.row_type ?? "");
  const [label, setLabel] = useState(row?.label ?? "");
  const [labelFr, setLabelFr] = useState(row?.label_fr ?? "");
  const [audience, setAudience] = useState(row?.audience ?? "all");
  const [platform, setPlatform] = useState(row?.platform ?? "all");
  const [cardStyle, setCardStyle] = useState(row?.card_style ?? "poster");
  const [cardLimit, setCardLimit] = useState(String(row?.card_limit ?? 15));
  const [hideWhenEmpty, setHideWhenEmpty] = useState(row?.hide_when_empty ?? true);
  const [isEnabled, setIsEnabled] = useState(row?.is_enabled ?? true);
  const [params, setParams] = useState<Record<string, string>>(initialParams);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedType = rowTypes.find((t) => t.key === rowType);

  function pickType(key: string) {
    setRowType(key);
    const def = rowTypes.find((t) => t.key === key);
    if (def) {
      setCardStyle(def.defaultCardStyle);
      if (!label.trim()) setLabel(def.label);
    }
  }

  async function save() {
    setErr(null);
    if (!rowType) { setErr("Pick a row type."); return; }
    if (!label.trim()) { setErr("A row label is required — it's what viewers read above the carousel."); return; }

    const cleanParams: Record<string, string | number> = {};
    for (const p of selectedType?.params ?? []) {
      const raw = params[p.key];
      if (raw != null && String(raw).trim() !== "") {
        cleanParams[p.key] = p.type === "number" ? Number(raw) : raw;
      }
    }

    const payload = {
      row_type: rowType,
      label: label.trim(),
      label_fr: labelFr.trim() || null,
      surface,
      platform,
      audience,
      card_style: cardStyle,
      card_limit: Number(cardLimit) || 15,
      hide_when_empty: hideWhenEmpty,
      is_enabled: isEnabled,
      params: Object.keys(cleanParams).length ? cleanParams : null,
    };

    setBusy(true);
    try {
      if (isEdit) await api(`/layout/rows/${row!.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/layout/rows", { method: "POST", body: JSON.stringify(payload) });
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save row.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{isEdit ? "Edit row" : "Add row"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-5">
          {/* Row type — fixed list only */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Row type</label>
            <p className="mb-2 text-xs text-slate-600">
              Each row type is a query built into the platform. There's no free-text query field — that's deliberate.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-1.5">
              {rowTypes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => pickType(t.key)}
                  className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                    rowType === t.key ? "bg-brand/15 ring-1 ring-brand/40" : "hover:bg-slate-800/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${rowType === t.key ? "text-brand" : "text-slate-200"}`}>{t.label}</span>
                    {t.personal && (
                      <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">Personal</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-slate-500">{t.description}</p>
                </button>
              ))}
            </div>
          </div>

          {selectedType?.personal && (
            <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5 text-xs text-blue-300">
              This row depends on who's watching, so it's fetched per viewer after first paint rather than being cached. Its slot is
              reserved in the layout so nothing shifts when it arrives.
            </p>
          )}

          {/* Labels */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Label</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} placeholder="Live Now" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">French label</label>
              <input type="text" value={labelFr} onChange={(e) => setLabelFr(e.target.value)} className={inputClass} placeholder="En direct" />
            </div>
          </div>

          {/* Audience + platform */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value)} className={selectClass}>
                {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Platform</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={selectClass}>
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Card style + limit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Card style</label>
              <select value={cardStyle} onChange={(e) => setCardStyle(e.target.value)} className={selectClass}>
                {CARD_STYLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Card limit</label>
              <input type="number" min={1} max={30} value={cardLimit} onChange={(e) => setCardLimit(e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* Params */}
          {selectedType?.params?.length ? (
            <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-xs font-medium text-slate-400">Row settings</p>
              {selectedType.params.map((p) => (
                <div key={p.key}>
                  <label className="mb-1 block text-xs text-slate-500">{p.label}</label>
                  <input
                    type={p.type === "number" ? "number" : "text"}
                    value={params[p.key] ?? ""}
                    onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          ) : null}

          <Toggle
            label="Hide when empty"
            description="When this row has nothing to show, render nothing at all — no header, no placeholder."
            checked={hideWhenEmpty}
            onChange={setHideWhenEmpty}
          />
          <Toggle label="Enabled" description="Disabled rows stay configured but don't appear on the site." checked={isEnabled} onChange={setIsEnabled} />

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : isEdit ? "Save changes" : "Add row"}
          </button>
        </div>
      </div>
    </div>
  );
}
