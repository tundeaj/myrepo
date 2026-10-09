import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { inputClass } from "./session/Panel";

interface ContentOption {
  id: number;
  title: string | null;
  slug: string;
  content_type: string;
  status: string;
}

/**
 * Type-to-search content picker, backed by /api/content-search (admin-only,
 * cross-content-type, includes drafts). Built for Coupons' "applies to
 * content" field, which previously asked an admin to type a numeric
 * content_id by hand — this replaces that with the same search-and-select
 * pattern already used for course lookups in Invoices.tsx, generalised
 * across every content type instead of one.
 */
export function ContentPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContentOption[]>([]);
  const [selected, setSelected] = useState<ContentOption | null>(null);
  const [loading, setLoading] = useState(false);

  // A saved value (editing an existing coupon) needs its display fields
  // resolved once — a bare id on its own tells the admin nothing useful.
  useEffect(() => {
    if (value == null) { setSelected(null); return; }
    if (selected?.id === value) return;
    api<{ items: ContentOption[] }>(`/content-search?ids=${value}`)
      .then((res) => setSelected(res.items[0] ?? null))
      .catch(() => setSelected(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api<{ items: ContentOption[] }>(`/content-search?q=${encodeURIComponent(query)}`)
        .then((res) => setResults(res.items))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
        <div className="min-w-0">
          <span className="truncate text-sm text-slate-200">{selected.title ?? `Untitled #${selected.id}`}</span>
          <span className="ml-2 text-xs capitalize text-slate-600">{selected.content_type}</span>
        </div>
        <button
          type="button"
          onClick={() => { onChange(null); setSelected(null); setQuery(""); }}
          className="shrink-0 text-xs text-slate-500 hover:text-red-400"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title or slug…"
        className={inputClass}
      />
      {loading && <p className="mt-1 text-xs text-slate-600">Searching…</p>}
      {!loading && results.length > 0 && (
        <div className="mt-1 max-h-48 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onChange(r.id); setSelected(r); setQuery(""); setResults([]); }}
              className="block w-full px-3 py-2 text-left text-xs hover:bg-slate-800"
            >
              <span className="text-slate-200">{r.title ?? `Untitled #${r.id}`}</span>
              <span className="ml-2 capitalize text-slate-600">{r.content_type} · {r.status}</span>
            </button>
          ))}
        </div>
      )}
      {!loading && query.trim() && results.length === 0 && (
        <p className="mt-1 text-xs text-slate-600">No matches.</p>
      )}
    </div>
  );
}
