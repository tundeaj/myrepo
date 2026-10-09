import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";

// ─── Types ─────────────────────────────────────────────────────────────────────

type AssetTab = "video" | "audio" | "trailer" | "substitute";
type SourceMode = "upload" | "hls_url" | "mp4_url" | "embed_url";

interface UploadFile {
  id: string;
  file: File;
  progress: number; // 0–100
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  assetId?: number;
  title: string;
  tags: string;
  editingMeta: boolean;
}

interface UrlEntry {
  id: string;
  url: string;
  title: string;
  tags: string;
  saving: boolean;
  saved: boolean;
  assetId?: number;
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fileToTitle(f: File): string {
  return f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const URL_SOURCE_LABELS: Record<Exclude<SourceMode, "upload">, string> = {
  hls_url: "HLS Stream URL",
  mp4_url: "MP4 / MOV URL",
  embed_url: "Embed URL (YouTube / Vimeo)",
};

const ACCEPT_MAP: Record<AssetTab, string> = {
  video: "video/mp4,video/quicktime,video/webm",
  audio: "audio/mpeg,audio/ogg,audio/wav,audio/aac",
  trailer: "video/mp4,video/quicktime,video/webm",
  substitute: "video/mp4,video/quicktime,video/webm",
};

// ─── Amber warning ─────────────────────────────────────────────────────────────

function UrlProtectionWarning() {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 flex-shrink-0">
        <path d="M12 9v4M12 17v.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <p>
        <strong className="font-medium">URL-linked media is always public.</strong>{" "}
        Assets sourced from an external URL cannot be protected. Do not use them for subscriber-only or paid content — attach an uploaded file instead.
      </p>
    </div>
  );
}

// ─── Tab bar ───────────────────────────────────────────────────────────────────

const TABS: { key: AssetTab; label: string }[] = [
  { key: "video", label: "Video" },
  { key: "audio", label: "Audio" },
  { key: "trailer", label: "Trailer" },
  { key: "substitute", label: "Substitute" },
];

// ─── File upload panel ─────────────────────────────────────────────────────────

function FileUploadPanel({ tab }: { tab: AssetTab }) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const newEntries: UploadFile[] = Array.from(fileList).map((f) => ({
      id: uid(),
      file: f,
      progress: 0,
      status: "queued",
      title: fileToTitle(f),
      tags: "",
      editingMeta: false,
    }));
    setFiles((prev) => [...prev, ...newEntries]);
    // Kick off simulated uploads
    newEntries.forEach((entry) => startUpload(entry));
  }

  function startUpload(entry: UploadFile) {
    // Simulate upload progress, then POST the asset record.
    // In production this would POST to a pre-signed URL / CDN endpoint.
    setFiles((prev) =>
      prev.map((f) => f.id === entry.id ? { ...f, status: "uploading", progress: 0 } : f),
    );

    let progress = 0;
    const interval = setInterval(() => {
      progress = Math.min(progress + Math.random() * 15 + 5, 90);
      setFiles((prev) =>
        prev.map((f) => f.id === entry.id ? { ...f, progress: Math.round(progress) } : f),
      );
    }, 300);

    // After ~2s, "complete" the upload and create the DB record
    setTimeout(async () => {
      clearInterval(interval);
      setFiles((prev) =>
        prev.map((f) => f.id === entry.id ? { ...f, progress: 95 } : f),
      );
      try {
        const res = await api<{ asset: { id: number } }>("/media", {
          method: "POST",
          body: JSON.stringify({
            title: entry.title || null,
            asset_type: tab,
            source_type: "upload",
            is_protected: true,
          }),
        });
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id
              ? { ...f, progress: 100, status: "done", assetId: res.asset.id }
              : f,
          ),
        );
      } catch (e: any) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id ? { ...f, status: "error", error: e.message ?? "Upload failed." } : f,
          ),
        );
      }
    }, 2200);
  }

  async function saveFileMeta(id: string) {
    const entry = files.find((f) => f.id === id);
    if (!entry || !entry.assetId) return;
    try {
      await api(`/media/${entry.assetId}`, {
        method: "PUT",
        body: JSON.stringify({ title: entry.title.trim() || null, tags: entry.tags.trim() || null }),
      });
      setFiles((prev) => prev.map((f) => f.id === id ? { ...f, editingMeta: false } : f));
    } catch (e: any) {
      alert(e.message ?? "Failed to save metadata.");
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <label
        className={`flex h-36 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
          dragging ? "border-brand bg-brand/10" : "border-slate-700 bg-slate-950/60 hover:border-brand hover:bg-brand/5"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_MAP[tab]}
          multiple
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
        />
        <Icon name="upload" className="mb-2 h-8 w-8 text-slate-500" />
        <p className="text-sm text-slate-400">
          {dragging ? "Drop to upload" : "Click or drag files here"}
        </p>
        <p className="text-xs text-slate-600 mt-1">Multiple files supported</p>
      </label>

      {/* File rows */}
      {files.length > 0 && (
        <div className="space-y-3">
          {files.map((f) => (
            <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">{f.file.name}</p>
                  <p className="text-xs text-slate-500">{(f.file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {f.status === "done" && !f.editingMeta && (
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.map((u) => u.id === f.id ? { ...u, editingMeta: true } : u))}
                      className="text-xs text-brand hover:underline"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(f.id)}
                    className="text-xs text-slate-500 hover:text-red-400"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              {(f.status === "uploading" || f.status === "queued") && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-500">{f.status === "queued" ? "Queued" : "Uploading…"}</span>
                    <span className="text-xs text-slate-500 tabular-nums">{f.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-brand transition-all duration-300"
                      style={{ width: `${f.progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Status badges */}
              {f.status === "done" && !f.editingMeta && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 border border-emerald-500/30">
                    Uploaded · pending transcode
                  </span>
                  {f.assetId && (
                    <span className="text-xs text-slate-600">ID: {f.assetId}</span>
                  )}
                </div>
              )}

              {f.status === "error" && (
                <p className="mt-2 text-xs text-red-400">{f.error}</p>
              )}

              {/* Meta edit form */}
              {f.status === "done" && f.editingMeta && (
                <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Title</label>
                    <input
                      type="text"
                      value={f.title}
                      onChange={(e) =>
                        setFiles((prev) => prev.map((u) => u.id === f.id ? { ...u, title: e.target.value } : u))
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-brand focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Tags (comma-separated)</label>
                    <input
                      type="text"
                      value={f.tags}
                      onChange={(e) =>
                        setFiles((prev) => prev.map((u) => u.id === f.id ? { ...u, tags: e.target.value } : u))
                      }
                      placeholder="education, nigeria"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-brand focus:outline-none"
                    />
                  </div>
                  <p className="text-xs text-slate-600">
                    Duration, resolution and file size will be updated automatically once transcoding completes.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.map((u) => u.id === f.id ? { ...u, editingMeta: false } : u))}
                      className="text-xs text-slate-500 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => saveFileMeta(f.id)}
                      className="rounded bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-dark"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── URL source panel ──────────────────────────────────────────────────────────

function UrlSourcePanel({ tab, mode }: { tab: AssetTab; mode: Exclude<SourceMode, "upload"> }) {
  const [entries, setEntries] = useState<UrlEntry[]>([{ id: uid(), url: "", title: "", tags: "", saving: false, saved: false }]);

  function addEntry() {
    setEntries((prev) => [...prev, { id: uid(), url: "", title: "", tags: "", saving: false, saved: false }]);
  }

  async function saveEntry(id: string) {
    const entry = entries.find((e) => e.id === id);
    if (!entry || !entry.url.trim()) return;
    setEntries((prev) => prev.map((e) => e.id === id ? { ...e, saving: true, error: undefined } : e));
    try {
      const body: Record<string, unknown> = {
        title: entry.title.trim() || null,
        asset_type: tab,
        source_type: mode,
        is_protected: false,
        tags: entry.tags.trim() || null,
      };
      body[mode] = entry.url.trim();

      const res = await api<{ asset: { id: number } }>("/media", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setEntries((prev) =>
        prev.map((e) => e.id === id ? { ...e, saving: false, saved: true, assetId: res.asset.id } : e),
      );
    } catch (err: any) {
      setEntries((prev) =>
        prev.map((e) => e.id === id ? { ...e, saving: false, error: err.message ?? "Failed to save." } : e),
      );
    }
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const label = URL_SOURCE_LABELS[mode];

  return (
    <div className="space-y-4">
      <UrlProtectionWarning />

      {entries.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          {entry.saved ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-200 truncate">{entry.title || entry.url}</p>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 border border-emerald-500/30">
                  Saved · ID {entry.assetId}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                className="text-xs text-slate-500 hover:text-red-400"
              >
                Remove
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
                <input
                  type="url"
                  value={entry.url}
                  onChange={(e) =>
                    setEntries((prev) => prev.map((en) => en.id === entry.id ? { ...en, url: e.target.value } : en))
                  }
                  placeholder="https://…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Title</label>
                  <input
                    type="text"
                    value={entry.title}
                    onChange={(e) =>
                      setEntries((prev) => prev.map((en) => en.id === entry.id ? { ...en, title: e.target.value } : en))
                    }
                    placeholder="Asset title"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-400">Tags</label>
                  <input
                    type="text"
                    value={entry.tags}
                    onChange={(e) =>
                      setEntries((prev) => prev.map((en) => en.id === entry.id ? { ...en, tags: e.target.value } : en))
                    }
                    placeholder="comma, separated"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
              {entry.error && <p className="text-sm text-red-400">{entry.error}</p>}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  className="text-xs text-slate-500 hover:text-red-400"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => saveEntry(entry.id)}
                  disabled={entry.saving || !entry.url.trim()}
                  className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {entry.saving ? "Saving…" : "Save Asset"}
                </button>
              </div>
            </>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 py-2.5 text-sm text-slate-500 hover:border-brand hover:text-brand transition-colors"
      >
        + Add another URL
      </button>
    </div>
  );
}

// ─── Source mode selector ──────────────────────────────────────────────────────

const SOURCE_MODES: { key: SourceMode; label: string; desc: string }[] = [
  { key: "upload", label: "Upload file", desc: "Drag and drop or choose files from your computer" },
  { key: "hls_url", label: "HLS Stream URL", desc: "Link to a .m3u8 manifest (CDN, Bunny, Cloudflare)" },
  { key: "mp4_url", label: "MP4 / MOV URL", desc: "Direct link to a hosted video file" },
  { key: "embed_url", label: "Embed URL", desc: "YouTube, Vimeo, or other iFrame embed source" },
];

// ─── Main component ────────────────────────────────────────────────────────────

export function UploadMedia() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AssetTab>("video");
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");

  // Reset source mode when tab changes
  function handleTabChange(tab: AssetTab) {
    setActiveTab(tab);
    setSourceMode("upload");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/admin/library")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300"
        >
          <Icon name="arrow-left" className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Upload Media</h1>
          <p className="text-sm text-slate-500">Add video, audio, trailers and substitute clips to the library</p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-6">
        {/* Asset type tabs */}
        <div className="flex rounded-lg border border-slate-800 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-500 hover:text-slate-300"
              } ${t.key !== "video" ? "border-l border-slate-800" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Source mode selector */}
        <div>
          <p className="mb-3 text-xs font-medium text-slate-400">Source</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SOURCE_MODES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSourceMode(s.key)}
                className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  sourceMode === s.key
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300"
                }`}
              >
                <p className="text-xs font-medium">{s.label}</p>
                <p className={`mt-0.5 text-xs leading-snug ${sourceMode === s.key ? "text-brand/70" : "text-slate-600"}`}>
                  {s.desc}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Content panel */}
        <div>
          {sourceMode === "upload" ? (
            <FileUploadPanel key={activeTab} tab={activeTab} />
          ) : (
            <UrlSourcePanel key={`${activeTab}-${sourceMode}`} tab={activeTab} mode={sourceMode} />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between border-t border-slate-800 pt-4">
          <p className="text-xs text-slate-600 max-w-sm leading-relaxed">
            Uploaded files will be queued for transcoding. Duration, resolution, and file size
            are populated automatically once processing completes.
          </p>
          <button
            onClick={() => navigate("/admin/library")}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:border-slate-600 hover:text-slate-200"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
