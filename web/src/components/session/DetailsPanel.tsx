import { useState } from "react";
import { Panel, Field, inputClass } from "./Panel";
import { api } from "../../lib/api";

interface Props {
  title: string;
  slug: string;
  shortDescription: string;
  descriptionHtml: string;
  onTitle: (v: string) => void;
  onSlug: (v: string) => void;
  onShortDescription: (v: string) => void;
  onDescriptionHtml: (v: string) => void;
  slugError?: string;
  errors: Record<string, string>;
  sessionId?: number;
  categoryName?: string;
  speakerNames?: string[];
}

export function DetailsPanel({
  title,
  slug,
  shortDescription,
  descriptionHtml,
  onTitle,
  onSlug,
  onShortDescription,
  onDescriptionHtml,
  slugError,
  errors,
  sessionId,
  categoryName,
  speakerNames = [],
}: Props) {
  const [slugEditing, setSlugEditing] = useState(false);
  const [slugChecking, setSlugChecking] = useState(false);
  const [aiField, setAiField] = useState<"short_description" | "description_html" | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ field: string; text: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const descCount = shortDescription.length;
  const descCountColor = descCount >= 250 ? "text-red-400" : descCount >= 220 ? "text-amber-400" : "text-slate-600";

  async function checkSlug(value: string) {
    if (!value) return;
    setSlugChecking(true);
    try {
      await api<{ available: boolean }>(`/sessions/check-slug?slug=${encodeURIComponent(value)}${sessionId ? `&exclude_id=${sessionId}` : ""}`);
    } finally {
      setSlugChecking(false);
    }
  }

  function handleTitleChange(v: string) {
    onTitle(v);
    if (!slugEditing) {
      const auto = v
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 220);
      onSlug(auto);
    }
  }

  async function handleAiSuggest(field: "short_description" | "description_html") {
    // The server needs a title for context and rejects the call without one.
    // Say so here rather than spending a request to be told.
    if (!title.trim()) {
      setAiField(field);
      setAiError("Add a title first — the AI needs something to write about.");
      return;
    }

    setAiField(field);
    setAiLoading(true);
    setAiPreview(null);
    setAiError(null);
    try {
      const res = await api<{ suggestion: string }>("/ai/suggest", {
        method: "POST",
        body: JSON.stringify({ field, title, category: categoryName, speakerNames }),
      });
      setAiPreview({ field, text: res.suggestion });
    } catch (err: any) {
      // Rate limits and "not configured yet" are both things the user can act
      // on — swallowing them leaves a button that just does nothing.
      setAiError(err?.message ?? "Couldn't generate a suggestion. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  function useAiSuggestion() {
    if (!aiPreview) return;
    if (aiPreview.field === "short_description") onShortDescription(aiPreview.text.slice(0, 250));
    else onDescriptionHtml(aiPreview.text);
    setAiPreview(null);
    setAiField(null);
  }

  return (
    <Panel title="Session Details" error={!!(errors.title || errors.slug)}>
      <div className="space-y-4">
        {/* Title */}
        <Field label="Title" required error={errors.title}>
          <input
            className={inputClass}
            type="text"
            maxLength={200}
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="e.g. Scaling Your Business in West Africa"
          />
        </Field>

        {/* Slug */}
        <Field label="Slug" error={slugError} hint="Auto-generated. Click the pencil to edit.">
          <div className="flex items-center gap-2">
            <input
              className={`${inputClass} flex-1 font-mono text-xs`}
              type="text"
              value={slug}
              readOnly={!slugEditing}
              onChange={(e) => onSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onBlur={() => { if (slugEditing) checkSlug(slug); }}
            />
            <button
              type="button"
              title={slugEditing ? "Lock slug" : "Edit slug"}
              onClick={() => setSlugEditing((v) => !v)}
              className="flex-shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              {slugEditing ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              )}
            </button>
            {slugChecking && <span className="text-xs text-slate-500">checking…</span>}
            {slugError && <span className="text-xs text-red-400">{slugError}</span>}
          </div>
        </Field>

        {/* Short Description */}
        <Field label="Short Description" hint="Shown in cards and previews.">
          <div className="relative">
            <textarea
              className={`${inputClass} resize-none`}
              rows={3}
              maxLength={250}
              value={shortDescription}
              onChange={(e) => onShortDescription(e.target.value)}
              placeholder="One to two sentences that hook the viewer."
            />
            <span className={`absolute bottom-2 right-2 text-xs ${descCountColor}`}>
              {descCount}/250
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleAiSuggest("short_description")}
            disabled={aiLoading && aiField === "short_description"}
            className="mt-1.5 flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-50"
          >
            {aiLoading && aiField === "short_description" ? "Generating…" : "✨ AI Suggest"}
          </button>
          {aiError && aiField === "short_description" && (
            <p className="mt-1.5 text-xs text-amber-400">{aiError}</p>
          )}
          {aiPreview?.field === "short_description" && (
            <AiPreview text={aiPreview.text} onUse={useAiSuggestion} onDiscard={() => setAiPreview(null)} />
          )}
        </Field>

        {/* Session Details (rich text — textarea until editor library added) */}
        <Field label="Session Details" hint="Full description. Supports HTML for rich formatting.">
          <textarea
            className={`${inputClass} resize-y`}
            rows={8}
            value={descriptionHtml}
            onChange={(e) => onDescriptionHtml(e.target.value)}
            placeholder="<p>Describe the session in detail…</p>"
          />
          <button
            type="button"
            onClick={() => handleAiSuggest("description_html")}
            disabled={aiLoading && aiField === "description_html"}
            className="mt-1.5 flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-50"
          >
            {aiLoading && aiField === "description_html" ? "Generating…" : "✨ AI Suggest"}
          </button>
          {aiError && aiField === "description_html" && (
            <p className="mt-1.5 text-xs text-amber-400">{aiError}</p>
          )}
          {aiPreview?.field === "description_html" && (
            <AiPreview text={aiPreview.text} onUse={useAiSuggestion} onDiscard={() => setAiPreview(null)} />
          )}
        </Field>
      </div>
    </Panel>
  );
}

function AiPreview({ text, onUse, onDiscard }: { text: string; onUse: () => void; onDiscard: () => void }) {
  return (
    <div className="mt-2 rounded-lg border border-brand/30 bg-brand/5 p-3">
      <p className="mb-2 text-xs font-medium text-brand">AI Suggestion Preview</p>
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-300">{text}</div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onUse}
          className="rounded bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand-dark"
        >
          Use this
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
