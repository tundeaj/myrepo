import { useState, useRef, useCallback } from "react";
import { Panel } from "./Panel";

// The four variant previews as per the spec
const VARIANTS = [
  { key: "poster", label: "Poster", ratio: 2 / 3, width: 120, height: 180 },
  { key: "player", label: "Player 16:9", ratio: 16 / 9, width: 200, height: 113 },
  { key: "square", label: "Square 1:1", ratio: 1, width: 140, height: 140 },
  { key: "thumb", label: "Thumb 16:9", ratio: 16 / 9, width: 160, height: 90 },
];

const MIN_WIDTH = 2400;
const MIN_HEIGHT = 1350;

interface Props {
  masterImageUrl: string;
  focalX: number; // 0-100
  focalY: number; // 0-100
  imageOverrides: Record<string, string>;
  onMasterImageUrl: (url: string) => void;
  onFocalX: (x: number) => void;
  onFocalY: (y: number) => void;
  onImageOverrides: (overrides: Record<string, string>) => void;
}

export function ArtworkPanel({
  masterImageUrl,
  focalX,
  focalY,
  imageOverrides,
  onMasterImageUrl,
  onFocalX,
  onFocalY,
  onImageOverrides,
}: Props) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Validate and load image
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
    img.onerror = () => setUploadError("Failed to load image. Please try a different file.");
    img.src = url;
  }

  // Focal point dragging
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
    <Panel title="Artwork" description="Upload one master image ≥ 2400×1350px. All sizes are generated automatically.">
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
            {/* Focal point picker */}
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
              {/* Crosshair */}
              <div
                className="pointer-events-none absolute"
                style={{
                  left: `${focalX}%`,
                  top: `${focalY}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className={`h-5 w-5 rounded-full border-2 border-white shadow-lg ${dragging ? "scale-125" : ""} transition-transform`}>
                  <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                </div>
                {/* crosshair lines */}
                <div className="absolute left-1/2 top-0 h-px w-px -translate-x-1/2">
                  <div className="absolute left-0 top-0 h-px w-16 -translate-x-1/2 bg-white/50" />
                  <div className="absolute left-0 top-0 h-16 w-px -translate-y-1/2 bg-white/50" />
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between px-1">
              <p className="text-xs text-slate-500">
                Focal point: {focalX}%, {focalY}% — drag crosshair to reposition
              </p>
              <button
                type="button"
                onClick={() => { onMasterImageUrl(""); }}
                className="text-xs text-slate-500 hover:text-red-400"
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <p className="text-sm text-red-400">{uploadError}</p>
        )}

        {/* Live variant previews */}
        {masterImageUrl && (
          <div>
            <p className="mb-3 text-xs font-medium text-slate-400">Crop previews</p>
            <div className="grid grid-cols-2 gap-3">
              {VARIANTS.map((v) => (
                <VariantPreview
                  key={v.key}
                  variant={v}
                  imageUrl={overrideOrMaster(imageOverrides, v.key, masterImageUrl)}
                  focalX={focalX}
                  focalY={focalY}
                  override={imageOverrides[v.key]}
                  onOverride={(url) => onImageOverrides({ ...imageOverrides, [v.key]: url })}
                  onClearOverride={() => {
                    const next = { ...imageOverrides };
                    delete next[v.key];
                    onImageOverrides(next);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function overrideOrMaster(overrides: Record<string, string>, key: string, master: string) {
  return overrides[key] || master;
}

// ─── VariantPreview ───────────────────────────────────────────────────────────
interface VariantPreviewProps {
  variant: typeof VARIANTS[number];
  imageUrl: string;
  focalX: number;
  focalY: number;
  override?: string;
  onOverride: (url: string) => void;
  onClearOverride: () => void;
}

function VariantPreview({ variant, imageUrl, focalX, focalY, override, onOverride, onClearOverride }: VariantPreviewProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{variant.label}</span>
        {override ? (
          <button type="button" onClick={onClearOverride} className="text-xs text-slate-500 hover:text-red-400">
            Clear override
          </button>
        ) : (
          <label className="cursor-pointer text-xs text-brand hover:underline">
            Override
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onOverride(URL.createObjectURL(f));
              }}
            />
          </label>
        )}
      </div>
      {/* The crop preview uses object-position to simulate focal point */}
      <div
        className="overflow-hidden rounded-md border border-slate-800 bg-slate-950"
        style={{ width: "100%", aspectRatio: `${variant.width}/${variant.height}` }}
      >
        <img
          src={imageUrl}
          alt={variant.label}
          className="h-full w-full object-cover"
          style={{ objectPosition: `${focalX}% ${focalY}%` }}
        />
      </div>
    </div>
  );
}
