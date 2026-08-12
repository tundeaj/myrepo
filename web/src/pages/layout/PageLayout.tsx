import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { inputClass } from "../../components/session/Panel";
import { RowSlideOver, type ContentRow, type RowTypeDef } from "../../components/layout/RowSlideOver";
import { OrderingRules } from "../../components/layout/OrderingRules";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface RowPreview {
  row_id: number;
  personal: boolean;
  thumbnails: string[];
  item_count?: number;
}

interface RowsResponse {
  rows: ContentRow[];
  warnings: string[];
  previews: RowPreview[];
}

const SURFACES = [
  { value: "home", label: "Home" },
  { value: "live", label: "Live & Upcoming" },
  { value: "courses", label: "Courses" },
  { value: "category", label: "Category" },
  { value: "speaker", label: "Speaker" },
  { value: "landing", label: "Landing" },
];

const PLATFORMS = [
  { value: "web", label: "Web" },
  { value: "mobile", label: "Mobile" },
];

const AUDIENCE_LABELS: Record<string, string> = {
  all: "Everyone",
  logged_out: "Signed-out",
  registered: "Registered",
  subscriber: "Subscribers",
  enrolled: "Enrolled",
};

const CARD_STYLE_LABELS: Record<string, string> = {
  poster: "Poster",
  landscape: "Landscape",
  numbered: "Numbered",
  tile: "Tile",
  speaker: "Speaker",
};

// ─── Row card ──────────────────────────────────────────────────────────────────

function RowCard({
  row,
  preview,
  rowTypes,
  onEdit,
  onToggle,
  onDelete,
  dragHandlers,
  isDragging,
  isDropTarget,
}: {
  row: ContentRow;
  preview: RowPreview | undefined;
  rowTypes: RowTypeDef[];
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  dragHandlers: {
    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  isDragging: boolean;
  isDropTarget: boolean;
}) {
  const typeDef = rowTypes.find((t) => t.key === row.row_type);

  return (
    <li
      draggable
      {...dragHandlers}
      className={`rounded-xl border bg-slate-900/40 p-3 transition-all ${
        row.is_enabled ? "border-slate-800" : "border-slate-800/60 opacity-50"
      } ${isDragging ? "opacity-30" : ""} ${isDropTarget ? "border-brand ring-1 ring-brand/40" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <button
          className="mt-1 flex-shrink-0 cursor-grab text-slate-600 hover:text-slate-400 active:cursor-grabbing"
          title="Drag to reorder"
          aria-label="Drag to reorder"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <circle cx="7" cy="5" r="1.4" /><circle cx="13" cy="5" r="1.4" />
            <circle cx="7" cy="10" r="1.4" /><circle cx="13" cy="10" r="1.4" />
            <circle cx="7" cy="15" r="1.4" /><circle cx="13" cy="15" r="1.4" />
          </svg>
        </button>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-slate-100">{row.label}</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{typeDef?.label ?? row.row_type}</span>
            <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-500">{AUDIENCE_LABELS[row.audience] ?? row.audience}</span>
            {typeDef?.personal && (
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-300">Personal</span>
            )}
            {row.platform !== "all" && (
              <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[11px] capitalize text-slate-500">{row.platform} only</span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {CARD_STYLE_LABELS[row.card_style] ?? row.card_style} · up to {row.card_limit} cards
            {row.hide_when_empty ? " · hidden when empty" : ""}
            {preview && !preview.personal && preview.item_count != null ? ` · ${preview.item_count} available now` : ""}
          </p>
        </div>

        {/* Thumbnail strip */}
        <div className="hidden flex-shrink-0 items-center gap-1 sm:flex">
          {preview?.personal ? (
            <span className="rounded bg-slate-800/60 px-2 py-1 text-[11px] text-slate-500">Per viewer</span>
          ) : preview?.thumbnails.length ? (
            preview.thumbnails.map((src, i) => (
              <img key={i} src={src} alt="" className="h-8 w-14 rounded object-cover" />
            ))
          ) : (
            <span className="rounded bg-slate-800/40 px-2 py-1 text-[11px] text-slate-600">Empty</span>
          )}
        </div>

        {/* Enabled toggle */}
        <button onClick={onToggle} className="mt-0.5 relative flex-shrink-0" title={row.is_enabled ? "Disable row" : "Enable row"}>
          <div className={`h-5 w-9 rounded-full transition-colors ${row.is_enabled ? "bg-brand" : "bg-slate-700"}`} />
          <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${row.is_enabled ? "translate-x-4" : ""}`} />
        </button>
      </div>

      <div className="mt-2 flex justify-end gap-2 border-t border-slate-800/60 pt-2">
        <button onClick={onEdit} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200">Edit</button>
        <button onClick={onDelete} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-red-900/30 hover:text-red-400">Delete</button>
      </div>
    </li>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function PageLayout() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"rows" | "rules">("rows");
  const [surface, setSurface] = useState("home");
  const [platform, setPlatform] = useState("web");

  const [data, setData] = useState<RowsResponse | null>(null);
  const [rowTypes, setRowTypes] = useState<RowTypeDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editingRow, setEditingRow] = useState<ContentRow | "new" | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  // Display settings (stored in the playback settings group)
  const [rowsInitial, setRowsInitial] = useState("");
  const [cardsPerRow, setCardsPerRow] = useState("");
  const [savingDisplay, setSavingDisplay] = useState(false);
  const [displayDirty, setDisplayDirty] = useState(false);

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const orderRef = useRef<ContentRow[]>([]);

  const loadRows = useCallback(() => {
    setLoading(true);
    setError(null);
    api<RowsResponse>(`/layout/rows?surface=${surface}&platform=${platform}`)
      .then((res) => { setData(res); orderRef.current = res.rows; setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load rows.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, [surface, platform]);

  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    api<{ row_types: RowTypeDef[] }>("/layout/row-types")
      .then((res) => setRowTypes(res.row_types))
      .catch(() => setRowTypes([]));
  }, []);

  // Load the two display settings this screen owns.
  useEffect(() => {
    api<{ groups: { key: string; fields: { key: string; value?: string }[] }[] }>("/settings")
      .then((res) => {
        const playback = res.groups.find((g) => g.key === "playback");
        const rowsKey = platform === "mobile" ? "playback.rows_initial_mobile" : "playback.rows_initial_web";
        setRowsInitial(playback?.fields.find((f) => f.key === rowsKey)?.value ?? "");
        setCardsPerRow(playback?.fields.find((f) => f.key === "playback.cards_per_row")?.value ?? "");
        setDisplayDirty(false);
      })
      .catch(() => { /* the settings hub surfaces its own errors; this is a convenience mirror */ });
  }, [platform]);

  async function saveDisplaySettings() {
    setSavingDisplay(true);
    try {
      const rowsKey = platform === "mobile" ? "playback.rows_initial_mobile" : "playback.rows_initial_web";
      await api("/settings/playback", {
        method: "PUT",
        body: JSON.stringify({ values: { [rowsKey]: rowsInitial, "playback.cards_per_row": cardsPerRow } }),
      });
      setDisplayDirty(false);
      toast("Display settings saved.");
    } catch (e: any) {
      toast(e.message ?? "Failed to save display settings.", "error");
    } finally {
      setSavingDisplay(false);
    }
  }

  async function toggleRow(row: ContentRow) {
    try {
      await api(`/layout/rows/${row.id}`, { method: "PUT", body: JSON.stringify({ is_enabled: !row.is_enabled }) });
      loadRows();
    } catch (e: any) {
      toast(e.message ?? "Failed to update row.", "error");
    }
  }

  async function deleteRow(row: ContentRow) {
    if (!confirm(`Delete the "${row.label}" row? Rules that promote it will stop firing.`)) return;
    try {
      await api(`/layout/rows/${row.id}`, { method: "DELETE" });
      toast("Row deleted.");
      loadRows();
    } catch (e: any) {
      toast(e.message ?? "Failed to delete row.", "error");
    }
  }

  async function persistOrder(rows: ContentRow[]) {
    try {
      await api("/layout/rows/reorder/set", {
        method: "PUT",
        body: JSON.stringify({ surface, ordered_ids: rows.map((r) => r.id) }),
      });
    } catch (e: any) {
      toast(e.message ?? "Failed to save the new order.", "error");
      loadRows();
    }
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex || !data) return;
    const rows = [...data.rows];
    const [moved] = rows.splice(dragIndex, 1);
    rows.splice(targetIndex, 0, moved);
    setData({ ...data, rows });
    persistOrder(rows);
  }

  async function rebuildCache() {
    setRebuilding(true);
    try {
      const res = await api<{ rebuilt: { cache_key: string; item_count: number }[] }>("/layout/cache/rebuild", {
        method: "POST",
        body: JSON.stringify({}),
      });
      toast(`Cache rebuilt — ${res.rebuilt.length} key${res.rebuilt.length === 1 ? "" : "s"} refreshed.`);
    } catch (e: any) {
      toast(e.message ?? "Failed to rebuild the cache.", "error");
    } finally {
      setRebuilding(false);
    }
  }

  const rowOptions = (data?.rows ?? []).map((r) => ({ row_key: r.row_key, label: r.label }));

  return (
    <div className="space-y-5">
      {editingRow && (
        <RowSlideOver
          row={editingRow === "new" ? null : editingRow}
          surface={surface}
          rowTypes={rowTypes}
          onClose={() => setEditingRow(null)}
          onSaved={() => { setEditingRow(null); loadRows(); toast("Row saved."); }}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Page Layout</h1>
          <p className="mt-1 text-sm text-slate-500">The rows that make up each surface, and the rules that reorder them per viewer.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={rebuildCache} disabled={rebuilding} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            {rebuilding ? "Rebuilding…" : "Rebuild cache"}
          </button>
          {tab === "rows" && (
            <button onClick={() => setEditingRow("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              <Icon name="layout" className="h-4 w-4" />
              Add row
            </button>
          )}
        </div>
      </div>

      {/* Surface / platform / display settings bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Surface</label>
          <select value={surface} onChange={(e) => setSurface(e.target.value)} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none">
            {SURFACES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Platform</label>
          <div className="flex rounded-lg border border-slate-800 overflow-hidden">
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPlatform(p.value)}
                className={`px-4 py-2 text-sm ${platform === p.value ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-slate-400">Rows loaded initially</label>
          <input
            type="number"
            min={1}
            max={20}
            value={rowsInitial}
            onChange={(e) => { setRowsInitial(e.target.value); setDisplayDirty(true); }}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-600">Before "show more"</p>
        </div>
        <div className="w-32">
          <label className="mb-1 block text-xs font-medium text-slate-400">Cards per row</label>
          <input
            type="number"
            min={5}
            max={30}
            value={cardsPerRow}
            onChange={(e) => { setCardsPerRow(e.target.value); setDisplayDirty(true); }}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-600">Max fetched per row</p>
        </div>
        {displayDirty && (
          <button onClick={saveDisplaySettings} disabled={savingDisplay} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {savingDisplay ? "Saving…" : "Save"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {(["rows", "rules"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === t ? "border-b-2 border-brand font-medium text-brand" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t === "rows" ? "Rows" : "Ordering rules"}
          </button>
        ))}
      </div>

      {tab === "rules" ? (
        <OrderingRules surface={surface} platform={platform} rowOptions={rowOptions} />
      ) : loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={loadRows} />
      ) : (
        <>
          {/* Non-blocking warnings */}
          {data?.warnings.map((w, i) => (
            <div key={i} className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
              <span className="flex-shrink-0">⚠</span>
              <span>{w}</span>
            </div>
          ))}

          {!data?.rows.length ? (
            <EmptyState
              icon={<Icon name="layout" className="h-6 w-6" />}
              heading="No rows on this surface"
              explanation="Add a row to decide what visitors see here. Every row type is a query built into the platform — pick one and give it a label."
              actionLabel="Add row"
              onAction={() => setEditingRow("new")}
            />
          ) : (
            <ul className="space-y-2">
              {data.rows.map((row, index) => (
                <RowCard
                  key={row.id}
                  row={row}
                  preview={data.previews.find((p) => p.row_id === row.id)}
                  rowTypes={rowTypes}
                  onEdit={() => setEditingRow(row)}
                  onToggle={() => toggleRow(row)}
                  onDelete={() => deleteRow(row)}
                  isDragging={dragIndex === index}
                  isDropTarget={dropIndex === index && dragIndex !== index}
                  dragHandlers={{
                    onDragStart: () => setDragIndex(index),
                    onDragOver: (e) => { e.preventDefault(); setDropIndex(index); },
                    onDrop: (e) => { e.preventDefault(); handleDrop(index); setDragIndex(null); setDropIndex(null); },
                    onDragEnd: () => { setDragIndex(null); setDropIndex(null); },
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
