import { useState } from "react";
import { Panel, inputClass } from "../session/Panel";
import { api } from "../../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LessonType = "vod" | "live" | "text" | "quiz" | "assignment";

export interface CourseLesson {
  id?: number;
  title: string;
  lesson_type: LessonType;
  media_asset_id: number | null;
  body_html: string;
  is_preview: boolean;
  display_order: number;
  // Read-only from server
  asset?: {
    id: number;
    title: string | null;
    duration_seconds: number | null;
    transcode_status: string;
    thumbnail_url: string | null;
  } | null;
}

export interface CourseModule {
  id?: number;
  title: string;
  drip_days_after_enrolment: number;
  display_order: number;
  lessons: CourseLesson[];
}

interface Props {
  modules: CourseModule[];
  onChange: (modules: CourseModule[]) => void;
  errors?: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const LESSON_TYPES: { value: LessonType; label: string; icon: string }[] = [
  { value: "vod", label: "Video", icon: "🎬" },
  { value: "live", label: "Live", icon: "🔴" },
  { value: "text", label: "Text", icon: "📝" },
  { value: "quiz", label: "Quiz", icon: "❓" },
  { value: "assignment", label: "Assignment", icon: "📋" },
];

// ─── Asset picker ─────────────────────────────────────────────────────────────

interface AssetPickerProps {
  assetId: number | null;
  asset: CourseLesson["asset"];
  onPick: (assetId: number | null, asset: CourseLesson["asset"]) => void;
}

function AssetPicker({ assetId, asset, onPick }: AssetPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  async function doSearch(q: string) {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await api<{ assets: any[] }>(`/media?asset_type=video&q=${encodeURIComponent(q)}&per_page=10`);
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

  if (assetId && asset) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2">
        {asset.thumbnail_url ? (
          <img src={asset.thumbnail_url} alt="" className="h-8 w-14 rounded object-cover" />
        ) : (
          <div className="flex h-8 w-14 items-center justify-center rounded bg-slate-700 text-xs text-slate-500">No thumb</div>
        )}
        <div className="flex-1 min-w-0">
          <p className="truncate text-xs font-medium text-slate-200">{asset.title || `Asset #${asset.id}`}</p>
          <p className="text-xs text-slate-500">
            {formatDuration(asset.duration_seconds)} · {asset.transcode_status}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onPick(null, null)}
          className="text-xs text-slate-500 hover:text-red-400"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-500 hover:border-brand hover:text-brand w-full text-left"
        >
          + Pick a video from Media Library
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); doSearch(e.target.value); }}
              placeholder="Search videos…"
              className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-brand focus:outline-none"
            />
            <button
              type="button"
              onClick={() => { setOpen(false); setQuery(""); setResults([]); }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
          {searching && <p className="text-xs text-slate-600">Searching…</p>}
          {results.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950 divide-y divide-slate-800 max-h-48 overflow-y-auto">
              {results.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pick(a)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-800"
                >
                  <div className="text-xs text-slate-300 flex-1 min-w-0">
                    <p className="truncate font-medium">{a.title || `Asset #${a.id}`}</p>
                    <p className="text-slate-500">{formatDuration(a.duration_seconds)} · {a.transcode_status}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {!searching && query && results.length === 0 && (
            <p className="text-xs text-slate-600">No videos found for "{query}".</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Lesson row ───────────────────────────────────────────────────────────────

interface LessonRowProps {
  lesson: CourseLesson;
  index: number;
  total: number;
  onUpdate: (patch: Partial<CourseLesson>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function LessonRow({ lesson, index, total, onUpdate, onRemove, onMoveUp, onMoveDown }: LessonRowProps) {
  const [expanded, setExpanded] = useState(false);
  const typeInfo = LESSON_TYPES.find((t) => t.value === lesson.lesson_type) ?? LESSON_TYPES[0];

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-base">{typeInfo.icon}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left text-xs font-medium text-slate-200 hover:text-slate-100 truncate"
        >
          {lesson.title || `Untitled ${typeInfo.label} Lesson`}
        </button>
        {lesson.asset?.duration_seconds != null && lesson.lesson_type === "vod" && (
          <span className="text-xs text-slate-500">{formatDuration(lesson.asset.duration_seconds)}</span>
        )}
        {lesson.is_preview && (
          <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-400">Preview</span>
        )}
        {/* Order */}
        <div className="flex gap-0.5">
          <button type="button" disabled={index === 0} onClick={onMoveUp}
            className="rounded px-1 py-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-30 text-xs">↑</button>
          <button type="button" disabled={index === total - 1} onClick={onMoveDown}
            className="rounded px-1 py-0.5 text-slate-600 hover:text-slate-300 disabled:opacity-30 text-xs">↓</button>
        </div>
        <button type="button" onClick={onRemove} className="text-slate-600 hover:text-red-400 text-xs">✕</button>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-slate-600 hover:text-slate-300 text-xs">
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Expanded form */}
      {expanded && (
        <div className="border-t border-slate-700 px-3 py-3 space-y-3">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Lesson Title</label>
            <input
              className={inputClass}
              value={lesson.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder={`${typeInfo.label} lesson title`}
              maxLength={200}
            />
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {LESSON_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => onUpdate({ lesson_type: t.value })}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    lesson.lesson_type === t.value
                      ? "bg-brand text-white"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* VOD: asset picker */}
          {lesson.lesson_type === "vod" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Video Asset</label>
              <AssetPicker
                assetId={lesson.media_asset_id}
                asset={lesson.asset ?? null}
                onPick={(assetId, asset) => onUpdate({ media_asset_id: assetId, asset })}
              />
              {lesson.asset && (
                <p className="mt-1 text-xs text-slate-600">
                  Duration is read-only — pulled automatically from the media asset.
                </p>
              )}
            </div>
          )}

          {/* Text / Live: body_html */}
          {(lesson.lesson_type === "text") && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Lesson Body (HTML)</label>
              <textarea
                value={lesson.body_html}
                onChange={(e) => onUpdate({ body_html: e.target.value })}
                rows={6}
                placeholder="<p>Lesson content here…</p>"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none font-mono"
              />
            </div>
          )}

          {/* Quiz / Assignment: placeholder */}
          {(lesson.lesson_type === "quiz" || lesson.lesson_type === "assignment") && (
            <div className="rounded-lg bg-slate-800/40 px-3 py-3 text-center">
              <p className="text-xs text-slate-500">
                {lesson.lesson_type === "quiz" ? "Quiz" : "Assignment"} editing is available in a future update.
                Save this lesson and configure it from the learner management panel.
              </p>
            </div>
          )}

          {/* Free preview toggle */}
          <label className="flex cursor-pointer items-center gap-2">
            <div className="relative flex-shrink-0">
              <input
                type="checkbox"
                className="sr-only"
                checked={lesson.is_preview}
                onChange={(e) => onUpdate({ is_preview: e.target.checked })}
              />
              <div className={`h-4 w-8 rounded-full transition-colors ${lesson.is_preview ? "bg-brand" : "bg-slate-700"}`} />
              <div className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${lesson.is_preview ? "translate-x-4" : ""}`} />
            </div>
            <span className="text-xs text-slate-300">Free preview — visible without enrolment</span>
          </label>
        </div>
      )}
    </div>
  );
}

// ─── CurriculumPanel ──────────────────────────────────────────────────────────

export function CurriculumPanel({ modules, onChange, errors = [] }: Props) {
  function addModule() {
    const newMod: CourseModule = {
      title: "",
      drip_days_after_enrolment: 0,
      display_order: modules.length,
      lessons: [],
    };
    onChange([...modules, newMod]);
  }

  function updateModule(mIdx: number, patch: Partial<CourseModule>) {
    onChange(modules.map((m, i) => (i === mIdx ? { ...m, ...patch } : m)));
  }

  function removeModule(mIdx: number) {
    onChange(modules.filter((_, i) => i !== mIdx));
  }

  function moveModule(mIdx: number, dir: "up" | "down") {
    const next = [...modules];
    const swapIdx = dir === "up" ? mIdx - 1 : mIdx + 1;
    [next[mIdx], next[swapIdx]] = [next[swapIdx], next[mIdx]];
    onChange(next.map((m, i) => ({ ...m, display_order: i })));
  }

  function addLesson(mIdx: number) {
    const mod = modules[mIdx];
    const newLesson: CourseLesson = {
      title: "",
      lesson_type: "vod",
      media_asset_id: null,
      body_html: "",
      is_preview: false,
      display_order: mod.lessons.length,
    };
    updateModule(mIdx, { lessons: [...mod.lessons, newLesson] });
  }

  function updateLesson(mIdx: number, lIdx: number, patch: Partial<CourseLesson>) {
    const mod = modules[mIdx];
    updateModule(mIdx, {
      lessons: mod.lessons.map((l, i) => (i === lIdx ? { ...l, ...patch } : l)),
    });
  }

  function removeLesson(mIdx: number, lIdx: number) {
    const mod = modules[mIdx];
    updateModule(mIdx, { lessons: mod.lessons.filter((_, i) => i !== lIdx) });
  }

  function moveLesson(mIdx: number, lIdx: number, dir: "up" | "down") {
    const mod = modules[mIdx];
    const next = [...mod.lessons];
    const swapIdx = dir === "up" ? lIdx - 1 : lIdx + 1;
    [next[lIdx], next[swapIdx]] = [next[swapIdx], next[lIdx]];
    updateModule(mIdx, { lessons: next.map((l, i) => ({ ...l, display_order: i })) });
  }

  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);

  return (
    <Panel
      title="Curriculum"
      description="Drag modules and lessons into the order learners will follow."
      error={errors.length > 0}
    >
      <div className="space-y-4">
        {/* Publish validation errors */}
        {errors.length > 0 && (
          <div className="rounded-lg bg-red-900/20 border border-red-800 px-3 py-2 space-y-1">
            {errors.map((e, i) => (
              <p key={i} className="text-xs text-red-400">• {e}</p>
            ))}
          </div>
        )}

        {/* Summary */}
        {modules.length > 0 && (
          <p className="text-xs text-slate-500">
            {modules.length} module{modules.length !== 1 ? "s" : ""} · {totalLessons} lesson{totalLessons !== 1 ? "s" : ""}
          </p>
        )}

        {/* Modules */}
        <div className="space-y-3">
          {modules.map((mod, mIdx) => (
            <div key={mIdx} className="rounded-xl border border-slate-700 bg-slate-900/40">
              {/* Module header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
                <span className="text-xs font-semibold text-slate-500 flex-shrink-0">
                  Module {mIdx + 1}
                </span>
                <input
                  className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none"
                  value={mod.title}
                  onChange={(e) => updateModule(mIdx, { title: e.target.value })}
                  placeholder="Module title"
                  maxLength={200}
                />
                {/* Drip days */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <label className="text-xs text-slate-500">Drip after</label>
                  <input
                    type="number"
                    min={0}
                    value={mod.drip_days_after_enrolment}
                    onChange={(e) => updateModule(mIdx, { drip_days_after_enrolment: parseInt(e.target.value) || 0 })}
                    className="w-14 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-brand focus:outline-none"
                  />
                  <label className="text-xs text-slate-500">days</label>
                </div>
                {/* Controls */}
                <div className="flex gap-0.5 flex-shrink-0">
                  <button type="button" disabled={mIdx === 0} onClick={() => moveModule(mIdx, "up")}
                    className="rounded p-1 text-slate-600 hover:text-slate-300 disabled:opacity-30 text-xs">↑</button>
                  <button type="button" disabled={mIdx === modules.length - 1} onClick={() => moveModule(mIdx, "down")}
                    className="rounded p-1 text-slate-600 hover:text-slate-300 disabled:opacity-30 text-xs">↓</button>
                  <button type="button" onClick={() => removeModule(mIdx)}
                    className="rounded p-1 text-slate-600 hover:text-red-400 text-xs">✕</button>
                </div>
              </div>

              {/* Lessons */}
              <div className="px-4 py-3 space-y-2">
                {mod.lessons.map((lesson, lIdx) => (
                  <LessonRow
                    key={lIdx}
                    lesson={lesson}
                    index={lIdx}
                    total={mod.lessons.length}
                    onUpdate={(patch) => updateLesson(mIdx, lIdx, patch)}
                    onRemove={() => removeLesson(mIdx, lIdx)}
                    onMoveUp={() => moveLesson(mIdx, lIdx, "up")}
                    onMoveDown={() => moveLesson(mIdx, lIdx, "down")}
                  />
                ))}

                <button
                  type="button"
                  onClick={() => addLesson(mIdx)}
                  className="flex items-center gap-1.5 text-xs text-brand hover:underline mt-1"
                >
                  + Add Lesson
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add module */}
        <button
          type="button"
          onClick={addModule}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700 py-3 text-sm text-slate-500 hover:border-brand hover:text-brand transition-colors"
        >
          + Add Module
        </button>
      </div>
    </Panel>
  );
}
