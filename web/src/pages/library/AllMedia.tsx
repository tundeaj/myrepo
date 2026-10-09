import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount } from "../../lib/format";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface MediaAsset {
  id: number;
  title: string | null;
  asset_type: string;
  source_type: string;
  hls_url: string | null;
  mp4_url: string | null;
  embed_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  file_size_mb: number | null;
  resolution: string | null;
  transcode_status: string;
  tags: string | null;
  is_protected: boolean;
  provider: string | null;
  created_at: string;
  used_in: number;
  uploader: { id: number; full_name: string | null; email: string } | null;
}

interface ListResponse {
  assets: MediaAsset[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

interface Reference {
  type: "content" | "lesson";
  id: number;
  title: string;
  role: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDur(s: number | null): string {
  if (!s) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatSize(mb: number | null): string {
  if (!mb) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function typeColor(type: string): string {
  const map: Record<string, string> = {
    video: "bg-indigo-500/20 text-indigo-300",
    audio: "bg-purple-500/20 text-purple-300",
    trailer: "bg-amber-500/20 text-amber-300",
    substitute: "bg-emerald-500/20 text-emerald-300",
    document: "bg-slate-700 text-slate-300",
  };
  return map[type] ?? "bg-slate-700 text-slate-300";
}

function statusColor(s: string): string {
  const map: Record<string, string> = {
    ready: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
    pending: "bg-slate-700/60 text-slate-400 border border-slate-600",
    processing: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
    failed: "bg-red-500/15 text-red-300 border border-red-500/30",
  };
  return map[s] ?? "bg-slate-700 text-slate-400";
}

function assetDisplayName(a: MediaAsset): string {
  return a.title || `Asset #${a.id}`;
}

// ─── Filter bar constants ───────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "trailer", label: "Trailer" },
  { value: "substitute", label: "Substitute" },
  { value: "document", label: "Document" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ready", label: "Ready" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

// ─── Rename modal ──────────────────────────────────────────────────────────────

function RenameModal({
  asset,
  onClose,
  onSaved,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onSaved: (updated: MediaAsset) => void;
}) {
  const [title, setTitle] = useState(asset.title ?? "");
  const [tags, setTags] = useState(asset.tags ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      const res = await api<{ asset: MediaAsset }>(`/media/${asset.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: title.trim() || null, tags: tags.trim() || null }),
      });
      onSaved(res.asset);
    } catch (e: any) {
      setErr(e.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-slate-100">Rename / Edit tags</h2>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
              placeholder="Asset title"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
              placeholder="education, nigeria, promo"
            />
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete-blocked modal ──────────────────────────────────────────────────────

function BlockedDeleteModal({
  asset,
  references,
  onClose,
}: {
  asset: MediaAsset;
  references: Reference[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Cannot delete</h2>
        <p className="mb-4 text-sm text-slate-400">
          <span className="font-medium text-slate-200">{assetDisplayName(asset)}</span> is referenced by{" "}
          {references.length} item{references.length !== 1 ? "s" : ""}. Remove these references first.
        </p>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800">
          {references.map((r, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-xs font-medium text-slate-200">{r.title}</p>
                <p className="text-xs text-slate-500 capitalize">
                  {r.type} · role: {r.role}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Used-in popover ──────────────────────────────────────────────────────────

function UsedInBadge({ asset }: { asset: MediaAsset }) {
  const [open, setOpen] = useState(false);
  const [refs, setRefs] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api<{ references: Reference[] }>(`/media/${asset.id}/references`)
      .then((r) => setRefs(r.references))
      .catch(() => setRefs([]))
      .finally(() => setLoading(false));
  }, [open, asset.id]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (asset.used_in === 0) {
    return <span className="text-xs text-slate-600">—</span>;
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-medium text-slate-300 hover:bg-slate-600"
      >
        {asset.used_in} use{asset.used_in !== 1 ? "s" : ""}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          <div className="border-b border-slate-800 px-3 py-2">
            <p className="text-xs font-medium text-slate-300">Used in {asset.used_in} place{asset.used_in !== 1 ? "s" : ""}</p>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-800">
            {loading && <p className="px-3 py-2 text-xs text-slate-500">Loading…</p>}
            {!loading && refs.map((r, i) => (
              <div key={i} className="px-3 py-2">
                <p className="text-xs font-medium text-slate-200 truncate">{r.title}</p>
                <p className="text-xs text-slate-500 capitalize">{r.type} · {r.role}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Overflow menu ─────────────────────────────────────────────────────────────

function OverflowMenu({
  asset,
  onRename,
  onDelete,
}: {
  asset: MediaAsset;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [open]);

  const playbackUrl = asset.hls_url || asset.mp4_url || asset.embed_url || null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-700 hover:text-slate-200"
        title="More actions"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
          {playbackUrl && (
            <a
              href={playbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              onClick={() => setOpen(false)}
            >
              <Icon name="play" className="h-3.5 w-3.5" />
              Preview
            </a>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); onRename(); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            <Icon name="file" className="h-3.5 w-3.5" />
            Rename / Tags
          </button>
          {(asset.hls_url || asset.mp4_url || asset.embed_url) && (
            <button
              type="button"
              onClick={() => {
                const url = asset.hls_url || asset.mp4_url || asset.embed_url || "";
                navigator.clipboard.writeText(url).catch(() => {});
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              <Icon name="clipboard" className="h-3.5 w-3.5" />
              Copy URL
            </button>
          )}
          <div className="my-1 border-t border-slate-800" />
          <button
            type="button"
            onClick={() => { setOpen(false); onDelete(); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Grid card ─────────────────────────────────────────────────────────────────

function GridCard({
  asset,
  onRename,
  onDelete,
}: {
  asset: MediaAsset;
  onRename: (a: MediaAsset) => void;
  onDelete: (a: MediaAsset) => void;
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-colors">
      {/* Thumbnail */}
      <div className="relative aspect-video bg-slate-950 flex-shrink-0">
        {asset.thumbnail_url ? (
          <img
            src={asset.thumbnail_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-700">
            <Icon name="video" className="h-8 w-8" />
          </div>
        )}
        {/* Duration pill */}
        {asset.duration_seconds != null && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-mono text-white">
            {formatDur(asset.duration_seconds)}
          </span>
        )}
        {/* Type chip */}
        <span className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${typeColor(asset.asset_type)}`}>
          {asset.asset_type}
        </span>
        {/* Overflow menu */}
        <div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <OverflowMenu asset={asset} onRename={() => onRename(asset)} onDelete={() => onDelete(asset)} />
        </div>
      </div>
      {/* Body */}
      <div className="flex flex-col flex-1 px-3 py-2.5 gap-1">
        <p className="text-xs font-medium text-slate-200 truncate" title={assetDisplayName(asset)}>
          {assetDisplayName(asset)}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{formatSize(asset.file_size_mb)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(asset.transcode_status)}`}>
            {asset.transcode_status}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function AllMedia() {
  const navigate = useNavigate();

  // View
  const [view, setView] = useState<"grid" | "list">("grid");
  const perPage = view === "grid" ? 24 : 25;

  // Filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [assetType, setAssetType] = useState("");
  const [transcodeStatus, setTranscodeStatus] = useState("");
  const [page, setPage] = useState(1);

  // Data
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();

  // Modals
  const [renamingAsset, setRenamingAsset] = useState<MediaAsset | null>(null);
  const [blockedAsset, setBlockedAsset] = useState<MediaAsset | null>(null);
  const [blockedRefs, setBlockedRefs] = useState<Reference[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // Fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      view,
    });
    if (debouncedQ) params.set("q", debouncedQ);
    if (assetType) params.set("asset_type", assetType);
    if (transcodeStatus) params.set("transcode_status", transcodeStatus);

    api<ListResponse>(`/media?${params}`)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load media.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [page, perPage, view, debouncedQ, assetType, transcodeStatus]);

  function handleAssetUpdated(updated: MediaAsset) {
    setData((prev) =>
      prev
        ? { ...prev, assets: prev.assets.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)) }
        : prev,
    );
    setRenamingAsset(null);
  }

  async function handleDeleteRequest(asset: MediaAsset) {
    if (!confirm(`Delete "${assetDisplayName(asset)}"? This cannot be undone.`)) return;
    setDeletingId(asset.id);
    try {
      await api(`/media/${asset.id}`, { method: "DELETE" });
      setData((prev) =>
        prev
          ? { ...prev, assets: prev.assets.filter((a) => a.id !== asset.id), meta: { ...prev.meta, total: prev.meta.total - 1 } }
          : prev,
      );
    } catch (e: any) {
      // 409 = in use
      if (e.status === 409) {
        try {
          const refs = await api<{ references: Reference[] }>(`/media/${asset.id}/references`);
          setBlockedRefs(refs.references);
          setBlockedAsset(asset);
        } catch {
          alert(e.message ?? "Cannot delete — asset is in use.");
        }
      } else {
        alert(e.message ?? "Failed to delete asset.");
      }
    } finally {
      setDeletingId(null);
    }
  }

  function handleExportCsv() {
    setExporting(true);
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (assetType) params.set("asset_type", assetType);
    if (transcodeStatus) params.set("transcode_status", transcodeStatus);

    const token = getToken();
    fetch(`/api/media/export-csv?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `media-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => alert("Export failed. Please try again."))
      .finally(() => setExporting(false));
  }

  const meta = data?.meta;
  const hasFilters = !!(debouncedQ || assetType || transcodeStatus);

  return (
    <div className="space-y-5">
      {/* Modals */}
      {renamingAsset && (
        <RenameModal
          asset={renamingAsset}
          onClose={() => setRenamingAsset(null)}
          onSaved={handleAssetUpdated}
        />
      )}
      {blockedAsset && (
        <BlockedDeleteModal
          asset={blockedAsset}
          references={blockedRefs}
          onClose={() => { setBlockedAsset(null); setBlockedRefs([]); }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Media Library</h1>
          <p className="text-sm text-slate-500">
            {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} asset${meta?.total === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={exporting}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200 disabled:opacity-50"
          >
            <Icon name="file" className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          <button
            onClick={() => navigate("/admin/library/upload")}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            <Icon name="upload" className="h-4 w-4" />
            Upload
          </button>
        </div>
      </div>

      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search media…"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
          />
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
        </div>
        <select
          value={assetType}
          onChange={(e) => { setAssetType(e.target.value); setPage(1); }}
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        >
          {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={transcodeStatus}
          onChange={(e) => { setTranscodeStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* View toggle */}
        <div className="ml-auto flex rounded-lg border border-slate-800 overflow-hidden">
          <button
            onClick={() => setView("grid")}
            className={`px-3 py-2 text-sm flex items-center gap-1 ${view === "grid" ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
          >
            <Icon name="grid" className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("list")}
            className={`px-3 py-2 text-sm flex items-center gap-1 border-l border-slate-800 ${view === "list" ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
          >
            <Icon name="menu" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        view === "grid" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-video w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        )
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={() => setPage((p) => p)} />
      ) : !data?.assets.length ? (
        <EmptyState
          icon={<Icon name="video" className="h-6 w-6" />}
          heading="No media yet"
          explanation={hasFilters ? "Try changing your filters." : "Upload your first video, audio, or document."}
          actionLabel={!hasFilters ? "Upload Media" : undefined}
          onAction={!hasFilters ? () => navigate("/admin/library/upload") : undefined}
          variant={hasFilters ? "filtered" : "create"}
        />
      ) : view === "grid" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {data.assets.map((a) => (
            <GridCard
              key={a.id}
              asset={a}
              onRename={setRenamingAsset}
              onDelete={handleDeleteRequest}
            />
          ))}
        </div>
      ) : (
        /* List view */
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Size</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Used in</th>
                  <th className="px-4 py-3 font-medium">Uploaded by</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {data.assets.map((a) => (
                  <tr key={a.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* 60×34 thumbnail */}
                        <div className="relative flex-shrink-0 overflow-hidden rounded" style={{ width: 60, height: 34 }}>
                          {a.thumbnail_url ? (
                            <img src={a.thumbnail_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-slate-800 text-slate-600">
                              <Icon name="video" className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <span className="max-w-[180px] truncate text-xs font-medium text-slate-200" title={assetDisplayName(a)}>
                          {assetDisplayName(a)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${typeColor(a.asset_type)}`}>
                        {a.asset_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 capitalize">
                      {a.source_type.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-slate-400">
                      {formatDur(a.duration_seconds)}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-slate-400">
                      {formatSize(a.file_size_mb)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(a.transcode_status)}`}>
                        {a.transcode_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <UsedInBadge asset={a} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {a.uploader ? (a.uploader.full_name ?? a.uploader.email) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {new Date(a.created_at).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <OverflowMenu
                          asset={a}
                          onRename={() => setRenamingAsset(a)}
                          onDelete={() => handleDeleteRequest(a)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Page {meta.page} of {meta.pages} · {formatCount(meta.total)} assets
          </p>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              disabled={page === meta.pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
