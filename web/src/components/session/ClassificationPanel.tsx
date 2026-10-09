import { useState } from "react";
import { Panel, Field, selectClass, inputClass } from "./Panel";
import { api } from "../../lib/api";
import { useApi } from "../../hooks/useApi";

interface Category {
  id: number;
  name: string;
}

const FORMATS = [
  { value: "webinar", label: "Webinar" },
  { value: "masterclass", label: "Masterclass" },
  { value: "panel", label: "Panel" },
  { value: "workshop", label: "Workshop" },
  { value: "ama", label: "AMA (Ask Me Anything)" },
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "yo", label: "Yoruba" },
  { value: "ig", label: "Igbo" },
  { value: "ha", label: "Hausa" },
  { value: "pt", label: "Portuguese" },
];

const RATINGS = [
  { value: "general", label: "General (All audiences)" },
  { value: "pg", label: "PG (Parental guidance)" },
  { value: "mature", label: "Mature (18+)" },
  { value: "professionals", label: "Professionals only" },
];

interface Props {
  categoryIds: number[];
  sessionFormat: string;
  language: string;
  contentRating: string;
  searchTags: string[];
  onCategoryIds: (ids: number[]) => void;
  onSessionFormat: (v: string) => void;
  onLanguage: (v: string) => void;
  onContentRating: (v: string) => void;
  onSearchTags: (tags: string[]) => void;
}

export function ClassificationPanel({
  categoryIds,
  sessionFormat,
  language,
  contentRating,
  searchTags,
  onCategoryIds,
  onSessionFormat,
  onLanguage,
  onContentRating,
  onSearchTags,
}: Props) {
  const categoriesState = useApi<{ categories: Category[] }>("/categories");
  const categories = categoriesState.data?.categories ?? [];

  const [tagInput, setTagInput] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  function toggleCategory(id: number) {
    onCategoryIds(
      categoryIds.includes(id) ? categoryIds.filter((c) => c !== id) : [...categoryIds, id],
    );
  }

  async function createCategory() {
    if (!newCatName.trim()) return;
    setAddingCategory(true);
    try {
      const res = await api<{ category: Category }>("/categories", {
        method: "POST",
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      categoriesState.retry(); // refresh list
      onCategoryIds([...categoryIds, res.category.id]);
      setNewCatName("");
    } finally {
      setAddingCategory(false);
    }
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", " "].includes(e.key) && tagInput.trim()) {
      e.preventDefault();
      const tag = tagInput.trim().replace(/,/g, "");
      if (tag && !searchTags.includes(tag)) {
        onSearchTags([...searchTags, tag]);
      }
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && searchTags.length > 0) {
      onSearchTags(searchTags.slice(0, -1));
    }
  }

  return (
    <Panel title="Classification">
      <div className="space-y-4">
        {/* Categories */}
        <Field label="Categories">
          <div className="flex flex-wrap gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => toggleCategory(cat.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  categoryIds.includes(cat.id)
                    ? "bg-brand text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {cat.name}
              </button>
            ))}
            {/* Inline add */}
            {addingCategory ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-100"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createCategory(); if (e.key === "Escape") setAddingCategory(false); }}
                  placeholder="Category name"
                />
                <button type="button" onClick={createCategory} className="text-xs text-brand hover:underline">Add</button>
                <button type="button" onClick={() => setAddingCategory(false)} className="text-xs text-slate-500">✕</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingCategory(true)}
                className="flex items-center gap-0.5 rounded-full border border-dashed border-slate-600 px-2.5 py-1 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-300"
              >
                ＋ New
              </button>
            )}
          </div>
        </Field>

        {/* Format */}
        <Field label="Session Format">
          <select className={selectClass} value={sessionFormat} onChange={(e) => onSessionFormat(e.target.value)}>
            <option value="">— Select format —</option>
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          {/* Language */}
          <Field label="Language">
            <select className={selectClass} value={language} onChange={(e) => onLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </Field>

          {/* Content Rating */}
          <Field label="Content Rating">
            <select className={selectClass} value={contentRating} onChange={(e) => onContentRating(e.target.value)}>
              {RATINGS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Search Tags */}
        <Field label="Search Tags" hint="Press Enter, comma, or space to add a tag.">
          <div
            className="flex min-h-[2.5rem] flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 focus-within:border-brand"
          >
            {searchTags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-0.5 text-xs text-slate-200"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => onSearchTags(searchTags.filter((t) => t !== tag))}
                  className="text-slate-500 hover:text-red-400"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="min-w-[120px] flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={searchTags.length === 0 ? "e.g. fintech, lagos, growth…" : ""}
            />
          </div>
        </Field>
      </div>
    </Panel>
  );
}
