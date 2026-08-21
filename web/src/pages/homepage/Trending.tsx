import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { inputClass } from "../../components/session/Panel";

/**
 * Which content plays in the public homepage's rotating hero banner
 * (Hero.tsx) — Netflix-style: full-bleed artwork, a muted looping teaser
 * clip fading in after a beat, auto-advancing every 8s, small pill
 * indicators to jump to any slide directly. All of that mechanism already
 * existed; this page is the piece that didn't — deciding WHICH items and in
 * WHAT ORDER, instead of an unordered checkbox in the session/course editor.
 *
 * Position is server-authoritative (ContentItem.hero_display_order, via
 * routes/trending.ts) — Promote/Demote swap a position with its immediate
 * neighbour and the server always returns the freshly-ordered list, so this
 * page never computes an order locally and risks drifting from what the
 * public hero actually renders.
 */

interface TrendingItem {
  id: number;
  title: string | null;
  slug: string;
  content_type: string;
  status: string;
  master_image_url: string | null;
  scheduled_start_at: string | null;
  hero_display_order: number;
}

interface SearchResult {
  id: number;
  title: string | null;
  slug: string;
  content_type: string;
  status: string;
  master_image_url: string | null;
  show_in_hero: boolean;
}

interface Suggestion {
  id: number;
  title: string | null;
  slug: string;
  content_type: string;
  status: string;
  master_image_url: string | null;
  recent_activity: number;
}

const STATUS_TONE: Record<string, string> = {
  live: "border-red-500/30 bg-red-500/15 text-red-300",
  registration_open: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  starting_soon: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  scheduled: "border-blue-500/30 bg-blue-500/15 text-blue-300",
  replay_ready: "border-slate-600 bg-slate-800 text-slate-300",
  ended: "border-slate-700 bg-slate-800 text-slate-500",
  draft: "border-slate-700 bg-slate-800 text-slate-500",
};

function Thumb({ url, title }: { url: string | null; title: string | null }) {
  return (
    <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-slate-800">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-600">
          <Icon name="image" className="h-4 w-4" />
        </div>
      )}
      <span className="sr-only">{title ?? "Untitled"}</span>
    </div>
  );
}

/** Type-to-search-and-add, distinct from components/ContentPicker.tsx: that
 *  one selects a single value for a form field, this one appends to a list
 *  and stays open for adding several in a row. */
function AddToTrending({ existingIds, onAdded }: { existingIds: Set<number>; onAdded: () => void }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api<{ items: SearchResult[] }>(`/content-search?q=${encodeURIComponent(query)}`)
        .then((res) => setResults(res.items))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function add(item: SearchResult) {
    setAddingId(item.id);
    try {
      await api("/trending", { method: "POST", body: JSON.stringify({ content_id: item.id }) });
      toast(`"${item.title ?? "Untitled"}" added to the trending list.`);
      onAdded();
    } catch (e: any) {
      toast(e.message ?? "Couldn't add that to the trending list.", "error");
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label className="mb-1 block text-xs font-medium text-slate-400">Add a session or course to the trending list</label>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title or slug…"
        className={inputClass}
      />
      {loading && <p className="mt-2 text-xs text-slate-600">Searching…</p>}
      {!loading && results.length > 0 && (
        <div className="mt-2 max-h-64 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800">
          {results.map((r) => {
            const already = r.show_in_hero || existingIds.has(r.id);
            return (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                <Thumb url={r.master_image_url} title={r.title} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{r.title ?? `Untitled #${r.id}`}</p>
                  <p className="text-xs capitalize text-slate-600">{r.content_type} · {r.status.replace(/_/g, " ")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => add(r)}
                  disabled={already || addingId === r.id}
                  className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {already ? "Already trending" : addingId === r.id ? "Adding…" : "Add"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {!loading && query.trim() && results.length === 0 && (
        <p className="mt-2 text-xs text-slate-600">No matches.</p>
      )}
    </div>
  );
}

/**
 * A light-touch nudge, not a second way onto the list — every chip's "+"
 * goes through the exact same POST /trending the search box above uses.
 * Ranked by recent watch activity (native PlaybackSession + non-native
 * MeetingAttendance, the last 7 days — see routes/trending.ts's own doc
 * comment for why NOT content_items.view_count, which nothing ever
 * populates). Absent entirely rather than shown empty — a fresh platform
 * with no watch history yet has nothing honest to suggest.
 */
function SuggestionChips({
  suggestions,
  busyId,
  onAdd,
}: {
  suggestions: Suggestion[];
  busyId: number | null;
  onAdd: (item: Suggestion) => void;
}) {
  if (!suggestions.length) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <p className="mb-2 text-xs font-medium text-slate-400">
        Recently popular, not yet trending <span className="text-slate-600">— last 7 days</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onAdd(s)}
            disabled={busyId === s.id}
            className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 py-1.5 pl-3 pr-2 text-xs text-slate-200 hover:border-brand/50 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="max-w-[16rem] truncate">{s.title ?? `Untitled #${s.id}`}</span>
            <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-400">
              {s.recent_activity}
            </span>
            <Icon name="flame" className="h-3.5 w-3.5 shrink-0 text-brand" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Trending() {
  const { toast } = useToast();
  const [items, setItems] = useState<TrendingItem[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<number | null>(null);

  // Fetched together so a change to one is never out of sync with the
  // other — adding an item (from the search box OR a suggestion chip) must
  // make it disappear from suggestions on the very next render, not the one
  // after.
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ items: TrendingItem[] }>("/trending"),
      // Suggestions are a nudge, not load-bearing — a failure here shouldn't
      // block the actual trending list from rendering.
      api<{ suggestions: Suggestion[] }>("/trending/suggestions").catch(() => ({ suggestions: [] })),
    ])
      .then(([trendingRes, suggestRes]) => {
        setItems(trendingRes.items);
        setSuggestions(suggestRes.suggestions);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message ?? "Failed to load the trending list.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addSuggestion(item: Suggestion) {
    setBusyId(item.id);
    try {
      await api("/trending", { method: "POST", body: JSON.stringify({ content_id: item.id }) });
      toast(`"${item.title ?? "Untitled"}" added to the trending list.`);
      load();
    } catch (e: any) {
      toast(e.message ?? "Couldn't add that to the trending list.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function move(item: TrendingItem, direction: "promote" | "demote") {
    setBusyId(item.id);
    try {
      const res = await api<{ items: TrendingItem[] }>(`/trending/${item.id}/${direction}`, { method: "POST" });
      setItems(res.items);
    } catch (e: any) {
      toast(e.message ?? `Couldn't ${direction} that item.`, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item: TrendingItem) {
    if (!confirm(`Remove "${item.title ?? "this item"}" from the trending list? It'll stop appearing in the homepage hero.`)) return;
    setBusyId(item.id);
    try {
      await api(`/trending/${item.id}`, { method: "DELETE" });
      setItems((prev) => prev?.filter((i) => i.id !== item.id) ?? null);
      toast("Removed from the trending list.");
    } catch (e: any) {
      toast(e.message ?? "Couldn't remove that item.", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  const existingIds = new Set((items ?? []).map((i) => i.id));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
          <Icon name="flame" className="h-5 w-5 text-brand" />
          Trending
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          What plays in the homepage's rotating hero banner, and in what order — the same auto-advancing, teaser-playing
          carousel visitors see at the top of the site. Promote an item to move it earlier in the rotation, demote to move
          it later, or remove it entirely. A change here goes live within moments, not the homepage's usual cache window.
        </p>
      </div>

      <SuggestionChips suggestions={suggestions} busyId={busyId} onAdd={addSuggestion} />

      <AddToTrending existingIds={existingIds} onAdded={load} />

      {!items?.length ? (
        <EmptyState
          icon={<Icon name="flame" className="h-6 w-6" />}
          heading="Nothing trending yet"
          explanation="Search for a session or course above and add it — the hero banner falls back to whatever's live or featured until you do."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {items.map((item, i) => (
                  <tr key={item.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 tabular-nums text-slate-500">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Thumb url={item.master_image_url} title={item.title} />
                        <span className="truncate font-medium text-slate-100">{item.title ?? `Untitled #${item.id}`}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-400">{item.content_type}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_TONE[item.status] ?? "border-slate-700 bg-slate-800 text-slate-400"}`}>
                        {item.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => move(item, "promote")}
                          disabled={i === 0 || busyId === item.id}
                          aria-label="Promote"
                          title="Move earlier in the rotation"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Icon name="arrowUp" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(item, "demote")}
                          disabled={i === items.length - 1 || busyId === item.id}
                          aria-label="Demote"
                          title="Move later in the rotation"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Icon name="arrowDown" className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          disabled={busyId === item.id}
                          className="ml-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
