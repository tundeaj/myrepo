import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { inputClass } from "../../components/session/Panel";

interface Variant {
  id: number;
  variant_key: string;
  label: string;
  width: number;
  height: number;
  aspect_ratio: string;
  imagekit_transform: string;
  usage_note: string | null;
  is_active: boolean;
  display_order: number;
}

// A sample source image used purely for the live preview — replace with a real
// asset from the media library in the finished admin build.
const PREVIEW_SOURCE = "data:image/svg+xml;base64," + btoa(`
  <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#0f172a"/>
    </linearGradient></defs>
    <rect width="400" height="400" fill="url(#g)"/>
    <text x="200" y="200" fill="#64748b" font-family="sans-serif" font-size="20" text-anchor="middle">Preview</text>
  </svg>
`);

function EditSlideOver({ variant, onClose, onSaved }: { variant: Variant; onClose: () => void; onSaved: (v: Variant) => void }) {
  const [label, setLabel] = useState(variant.label);
  const [width, setWidth] = useState(String(variant.width));
  const [height, setHeight] = useState(String(variant.height));
  const [transform, setTransform] = useState(variant.imagekit_transform);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const w = Number(width) || variant.width;
  const h = Number(height) || variant.height;

  async function save() {
    if (!label.trim() || !transform.trim() || !w || !h) {
      setErr("Label, dimensions and transform string are all required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const aspect_ratio = simplifyRatio(w, h);
      const res = await api<{ variant: Variant }>(`/image-variants/${variant.id}`, {
        method: "PUT",
        body: JSON.stringify({ label: label.trim(), width: w, height: h, aspect_ratio, imagekit_transform: transform.trim() }),
      });
      onSaved(res.variant);
    } catch (e: any) {
      setErr(e.message ?? "Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  function simplifyRatio(a: number, b: number): string {
    const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
    const d = gcd(a, b) || 1;
    return `${a / d}:${b / d}`;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Edit "{variant.label}"</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
          ⚠ Changing this affects every image on the platform. Preview before saving.
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Label</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Width (px)</label>
              <input type="number" value={width} onChange={(e) => setWidth(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Height (px)</label>
              <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">ImageKit transform string</label>
            <input type="text" value={transform} onChange={(e) => setTransform(e.target.value)} className={inputClass + " font-mono"} />
          </div>

          {/* Live preview */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-400">Live preview</p>
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950" style={{ aspectRatio: `${w}/${h}`, maxWidth: 220 }}>
              <img src={PREVIEW_SOURCE} alt="Preview" className="h-full w-full object-cover" />
            </div>
            <p className="mt-1 text-xs text-slate-600">{w}×{h}px · {simplifyRatio(w, h)}</p>
          </div>

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ImageVariants() {
  const { toast } = useToast();
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Variant | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ variants: Variant[] }>("/image-variants")
      .then((res) => { setVariants(res.variants); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load image variants.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(v: Variant) {
    setTogglingId(v.id);
    try {
      const res = await api<{ variant: Variant }>(`/image-variants/${v.id}`, { method: "PUT", body: JSON.stringify({ is_active: !v.is_active }) });
      setVariants((prev) => prev?.map((x) => (x.id === v.id ? res.variant : x)) ?? null);
    } catch (e: any) {
      toast(e.message ?? "Failed to update.", "error");
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  }
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing && (
        <EditSlideOver
          variant={editing}
          onClose={() => setEditing(null)}
          onSaved={(v) => { setVariants((prev) => prev?.map((x) => (x.id === v.id ? v : x)) ?? null); setEditing(null); toast("Image variant saved."); }}
        />
      )}

      <div>
        <h1 className="text-lg font-semibold text-slate-100">Image Variants</h1>
        <p className="mt-1 text-sm text-slate-500">The crop presets used everywhere an image renders across the platform.</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800">
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">Variant</th>
                <th className="px-4 py-3 font-medium">Dimensions</th>
                <th className="px-4 py-3 font-medium">Aspect ratio</th>
                <th className="px-4 py-3 font-medium">Transform</th>
                <th className="px-4 py-3 font-medium">Active</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/20">
              {variants?.map((v) => (
                <tr key={v.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-100">{v.label}</p>
                    <p className="text-xs text-slate-600">{v.usage_note}</p>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-400">{v.width}×{v.height}</td>
                  <td className="px-4 py-3 text-slate-400">{v.aspect_ratio}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.imagekit_transform}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(v)}
                      disabled={togglingId === v.id}
                      className="relative disabled:opacity-50"
                    >
                      <div className={`h-5 w-9 rounded-full transition-colors ${v.is_active ? "bg-brand" : "bg-slate-700"}`} />
                      <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${v.is_active ? "translate-x-4" : ""}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(v)} className="rounded px-2.5 py-1 text-xs text-brand hover:bg-brand/10">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
