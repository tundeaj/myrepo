import { useState, useRef, useCallback } from "react";
import { Panel } from "../session/Panel";
import { api } from "../../lib/api";

// ─── The four variant previews ─────────────────────────────────────────────────

const VARIANTS = [
  { key: "poster", label: "Poster", width: 120, height: 180 },
  { key: "player", label: "Player 16:9", width: 200, height: 113 },
  { key: "square", label: "Square 1:1", width: 140, height: 140 },
  { key: "thumb", label: "Thumb 16:9", width: 160, height: 90 },
];

const MIN_WIDTH = 2400;
const MIN_HEIGHT = 1350;

// ─── Media asset info (for trailer/substitute pickers) ────────────────────────

interface AssetInfo {
  id: number;
  title: string | null;
  duration_seconds: number | null;
  transcode_status: string;
  thumbnail_url: string | null;
}

interface MediaPickerProps {
  label: string;
  description: string;
  assetId: number | null;
  asset: AssetInfo | null;
  onPick: (id: number | null, asset: AssetInfo | null) => void;
  assetType?: string;
}

function MediaPicker({ label, description, assetId, asset, onPick, assetType = "video" }: MediaPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  async function doSearch(q: string) {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await api<{ assets: any[] }>(`/media?asset_type=${assetType}&q=${encodeURIComponent(q)}&per_page=10`);
      setResults(res.assets ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function pick(a: any) {
    onPick(a.id, {
      id: a.id,
      title: a.title,
      duration_seconds: a.duration_seconds,
      transcode_status: a.transcode_status,
      thumbnail_url: a.thumbnail_url,
    });
    setOpen(false);
    setQuery("");
    setResults([]);
  }

  function formatDur(s: number | null) {
    if (!s) return "—";
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  return (
    <div>
      <label className="mb-0.5 block text-xs font-medium text-slate-400">{label}</label>
      <p className="mb-2 text-xs text-slate-600">{description}</p>

      {assetId && asset ? (
        <div className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2">
          {asset.thumbnail_url ? (
            <img src={asset.thumbnail_url} alt="" className="h-8 w-14 rounded object-cover" />
          ) : (
            <div className="flex h-8 w-14 items-center justify-center rounded bg-slate-700 text-xs text-slate-500">
              No thumb
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-slate-200">{asset.title || `Asset #${asset.id}`}</p>
            <p className="text-xs text-slate-500">{formatDur(asset.duration_seconds)} · {asset.transcode_status}</p>
          </div>
          <button
            type="button"
            onClick={() => onPick(null, null)}
            className="text-xs text-slate-500 hover:text-red-400"
          >
            Remove
          </button>
        </div>
      ) : !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-dashed border-slate-700 px-3 py-2 text-left text-xs text-slate-500 hover:border-brand hover:text-brand"
        >
          + Select from Media Library
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); doSearch(e.target.value); }}
              placeholder="Search media…"
              className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-brand focus:outline-none"
            />
            <button type="button" onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
              className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
          </div>
          {searching && <p className="text-xs text-slate-600">Searching…</p>}
          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 divide-y divide-slate-800">
              {results.map((a) => (
                <button key={a.id} type="button" onClick={() => pick(a)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800">
                  <div className="flex-1 min-w-0 text-xs text-slate-300">
                    <p className="truncate font-medium">{a.title || `Asset #${a.id}`}</p>
                    <p className="text-slate-500">{formatDur(a.duration_seconds)} · {a.transcode_status}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!searching && query && results.length === 0 && (
            <p className="text-xs text-slate-600">No results for "{query}".</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  masterImageUrl: string;
  focalX: number;
  focalY: number;
  imageOverrides: Record<string, string>;
  trailerAssetId: number | null;
  trailerAsset: AssetInfo | null;
  substituteAssetId: number | null;
  substituteAsset: AssetInfo | null;
  onMasterImageUrl: (url: string) => void;
  onFocalX: (x: number) => void;
  onFocalY: (y: number) => void;
  onImageOverrides: (overrides: Record<string, string>) => void;
  onTrailerAsset: (id: number | null, asset: AssetInfo | null) => void;
  onSubstituteAsset: (id: number | null, asset: AssetInfo | null) => void;
}

// ─── CourseArtworkPanel ───────────────────────────────────────────────────────

export function CourseArtworkPanel({
  masterImageUrl,
  focalX,
  focalY,
  imageOverrides,
  trailerAssetId,
  trailerAsset,
  substituteAssetId,
  substituteAsset,
  onMasterImageUrl,
  onFocalX,
  onFocalY,
  onImageOverrides,
  onTrailerAsset,
  onSubstituteAsset,
}: Props) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  function handleFileChange(file: File) {
    setUploadError(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth < MIN_WIDTH || img.naturalHeight < MIN_HEIGHT) {
        setUploadError(
          `Image too small: ${img.naturalWidth}×${img.naturalHeight}px. Minimum is ${MIN_WIDTH}×${MIN_HEIGHT}px.`,
        );
        URL.revokeObjectURL(url);
        return;
      }
      onMasterImageUrl(url);
    };
    img.onerror = () => setUploadError("Failed to load image.");
    img.src = url;
  }

  const updateFocal = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (!pickerRef.current) return;
      const rect = pickerRef.current.getBoundingClientRect();
      const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
      const y = Math.round(Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)));
      onFocalX(x);
      onFocalY(y);
    },
    [onFocalX, onFocalY],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      updateFocal(e);
      const onMove = (ev: MouseEvent) => updateFocal(ev);
      const onUp = () => {
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [updateFocal],
  );

  return (
    <Panel title="Artwork & Media" description="Upload a master image ≥ 2400×1350px. Optionally link a trailer and substitute video.">
      <div className="space-y-5">
        {/* Upload area */}
        {!masterImageUrl ? (
          <label className="flex h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/60 transition-colors hover:border-brand hover:bg-brand/5">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(f); }}
            />
            <svg className="mb-2 h-8 w-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-slate-400">Click or drag to upload</p>
            <p className="text-xs text-slate-600">JPEG, PNG or WebP · min {MIN_WIDTH}×{MIN_HEIGHT}px</p>
          </label>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2">
            <div
              ref={pickerRef}
              className="relative w-full cursor-crosshair overflow-hidden rounded-lg"
              style={{ aspectRatio: "16/9" }}
              onMouseDown={handleMouseDown}
            >
              <img
                src={masterImageUrl}
                alt="Master artwork"
                className="h-full w-full object-cover select-none"
                draggable={false}
              />
              <div
                className="pointer-events-none absolute"
                style={{ left: `${focalX}%`, top: `${focalY}%`, transform: "translate(-50%, -50%)" }}
              >
                <div className={`h-5 w-5 rounded-full border-2 border-white shadow-lg ${dragging ? "scale-125" : ""} transition-transform`}>
                  <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </div>
                <div className="absolute left-1/2 top-0 h-px w-px -translate-x-1/2">
                  <div className="absolute left-0 top-0 h-px w-16 -translate-x-1/2 bg-white/50" />
                  <div className="absolute left-0 top-0 h-16 w-px -translate-y-1/2 bg-white/50" />
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between px-1">
              <p className="text-xs text-slate-500">Focal point: {focalX}%, {focalY}% — drag to reposition</p>
              <button type="button" onClick={() => onMasterImageUrl("")} className="text-xs text-slate-500 hover:text-red-400">
                Remove
              </button>
            </div>
          </div>
        )}

        {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}

        {/* Variant previews */}
        {masterImageUrl && (
          <div>
            <p className="mb-3 text-xs font-medium text-slate-400">Crop previews</p>
            <div className="grid grid-cols-2 gap-3">
              {VARIANTS.map((v) => (
                <div key={v.key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{v.label}</span>
                    {imageOverrides[v.key] ? (
                      <button type="button"
                        onClick={() => { const n = { ...imageOverrides }; delete n[v.key]; onImageOverrides(n); }}
                        className="text-xs text-slate-500 hover:text-red-400">Clear override</button>
                    ) : (
                      <label className="cursor-pointer text-xs text-brand hover:underline">
                        Override
                        <input type="file" accept="image/*" className="sr-only"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImageOverrides({ ...imageOverrides, [v.key]: URL.createObjectURL(f) }); }} />
                      </label>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950"
                    style={{ width: "100%", aspectRatio: `${v.width}/${v.height}` }}>
                    <img src={imageOverrides[v.key] || masterImageUrl} alt={v.label}
                      className="h-full w-full object-cover"
                      style={{ objectPosition: `${focalX}% ${focalY}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Separator */}
        <div className="border-t border-slate-800" />

        {/* Trailer */}
        <MediaPicker
          label="Trailer Video"
          description="A short preview clip shown to non-enrolled visitors on the course page."
          assetId={trailerAssetId}
          asset={trailerAsset}
          onPick={onTrailerAsset}
          assetType="trailer"
        />

        {/* Substitute */}
        <MediaPicker
          label="Substitute Video"
          description="Played in place of the full course when the learner has no entitlement (e.g. a longer preview or promo)."
          assetId={substituteAssetId}
          asset={substituteAsset}
          onPick={onSubstituteAsset}
          assetType="substitute"
        />
      </div>
    </Panel>
  );
}
