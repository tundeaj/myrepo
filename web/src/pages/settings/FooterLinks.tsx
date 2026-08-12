import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { inputClass } from "../../components/session/Panel";

interface Link {
  id: number;
  label: string | null;
  label_fr: string | null;
  url: string | null;
  column_group: string | null;
  display_order: number;
  opens_new_tab: boolean;
  is_active: boolean;
  is_required: boolean;
}

interface GroupRow {
  column_group: string;
  links: Link[];
}

const GROUP_LABELS: Record<string, string> = { legal: "Legal", company: "Company", product: "Product", resources: "Resources", other: "Other" };

function AddLinkForm({ columnGroup, onAdded, onCancel }: { columnGroup: string; onAdded: (l: Link) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!label.trim() || !url.trim()) { setErr("Label and URL are both required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ link: Link }>("/footer-links", {
        method: "POST",
        body: JSON.stringify({ label: label.trim(), url: url.trim(), column_group: columnGroup, opens_new_tab: false }),
      });
      onAdded(res.link);
      setLabel(""); setUrl("");
    } catch (e: any) {
      setErr(e.message ?? "Failed to add link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-slate-700 p-3">
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className={inputClass + " w-32"} />
      <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="/pages/… or https://…" className={inputClass + " flex-1 min-w-[160px]"} />
      <button onClick={add} disabled={busy} className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50">
        {busy ? "Adding…" : "Add"}
      </button>
      <button onClick={onCancel} className="rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-300">Cancel</button>
      {err && <p className="w-full text-xs text-red-400">{err}</p>}
    </div>
  );
}

function LinkRow({ link, onUpdated, onDeleted, onMove, isFirst, isLast }: {
  link: Link;
  onUpdated: (l: Link) => void;
  onDeleted: (id: number) => void;
  onMove: (id: number, dir: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      const res = await api<{ link: Link }>(`/footer-links/${link.id}`, { method: "PUT", body: JSON.stringify({ is_active: !link.is_active }) });
      onUpdated(res.link);
    } catch (e: any) {
      toast(e.message ?? "Failed to update.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${link.label}"?`)) return;
    setBusy(true);
    try {
      await api(`/footer-links/${link.id}`, { method: "DELETE" });
      onDeleted(link.id);
    } catch (e: any) {
      toast(e.message ?? "Failed to delete.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <button disabled={isFirst} onClick={() => onMove(link.id, "up")} className="text-slate-600 hover:text-slate-300 disabled:opacity-20">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3"><path d="M10 5l-5 6h10l-5-6z" /></svg>
        </button>
        <button disabled={isLast} onClick={() => onMove(link.id, "down")} className="text-slate-600 hover:text-slate-300 disabled:opacity-20">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3"><path d="M10 15l5-6H5l5 6z" /></svg>
        </button>
      </div>
      {link.is_required && <Icon name="shield" className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-200">{link.label}</p>
        <p className="truncate text-xs text-slate-600">{link.url}{link.opens_new_tab ? " · opens in new tab" : ""}</p>
      </div>
      <button onClick={toggleActive} disabled={busy} className="relative flex-shrink-0 disabled:opacity-50">
        <div className={`h-5 w-9 rounded-full transition-colors ${link.is_active ? "bg-brand" : "bg-slate-700"}`} />
        <div className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${link.is_active ? "translate-x-4" : ""}`} />
      </button>
      {link.is_required ? (
        <span className="flex-shrink-0 text-xs text-slate-600" title="Required link — cannot be deleted">Locked</span>
      ) : (
        <button onClick={remove} disabled={busy} className="flex-shrink-0 text-xs text-slate-500 hover:text-red-400 disabled:opacity-50">Delete</button>
      )}
    </div>
  );
}

export function FooterLinks() {
  const { toast } = useToast();
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ groups: GroupRow[] }>("/footer-links")
      .then((res) => { setGroups(res.groups); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load footer links.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateLink(l: Link) {
    setGroups((prev) => prev?.map((g) => ({ ...g, links: g.links.map((x) => (x.id === l.id ? l : x)) })) ?? null);
  }
  function removeLink(id: number) {
    setGroups((prev) => prev?.map((g) => ({ ...g, links: g.links.filter((x) => x.id !== id) })) ?? null);
  }
  function addLink(l: Link) {
    setGroups((prev) => {
      if (!prev) return prev;
      const exists = prev.some((g) => g.column_group === l.column_group);
      if (exists) return prev.map((g) => (g.column_group === l.column_group ? { ...g, links: [...g.links, l] } : g));
      return [...prev, { column_group: l.column_group!, links: [l] }];
    });
    setAddingTo(null);
  }

  async function move(groupKey: string, id: number, dir: "up" | "down") {
    const group = groups?.find((g) => g.column_group === groupKey);
    if (!group) return;
    const idx = group.links.findIndex((l) => l.id === id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= group.links.length) return;

    const reordered = [...group.links];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    setGroups((prev) => prev?.map((g) => (g.column_group === groupKey ? { ...g, links: reordered } : g)) ?? null);

    try {
      await api("/footer-links/reorder/set", {
        method: "PUT",
        body: JSON.stringify({ column_group: groupKey, ordered_ids: reordered.map((l) => l.id) }),
      });
    } catch (e: any) {
      toast(e.message ?? "Failed to reorder.", "error");
      load();
    }
  }

  if (loading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Footer Links</h1>
        <p className="mt-1 text-sm text-slate-500">Drag reorder within a column. Required links (🔒) can't be deleted.</p>
      </div>

      {groups?.map((group) => (
        <div key={group.column_group}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {GROUP_LABELS[group.column_group] ?? group.column_group}
          </h2>
          <div className="space-y-2">
            {group.links.map((link, i) => (
              <LinkRow
                key={link.id}
                link={link}
                onUpdated={updateLink}
                onDeleted={removeLink}
                onMove={(id, dir) => move(group.column_group, id, dir)}
                isFirst={i === 0}
                isLast={i === group.links.length - 1}
              />
            ))}
            {addingTo === group.column_group ? (
              <AddLinkForm columnGroup={group.column_group} onAdded={addLink} onCancel={() => setAddingTo(null)} />
            ) : (
              <button onClick={() => setAddingTo(group.column_group)} className="w-full rounded-lg border border-dashed border-slate-700 py-2 text-xs text-slate-500 hover:border-brand hover:text-brand">
                + Add link
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Allow adding a brand-new column group */}
      {addingTo === "__new__" ? (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">New column</h2>
          <NewColumnForm onAdded={(l) => addLink(l)} onCancel={() => setAddingTo(null)} />
        </div>
      ) : (
        <button onClick={() => setAddingTo("__new__")} className="text-xs text-brand hover:underline">+ Add a new footer column</button>
      )}
    </div>
  );
}

function NewColumnForm({ onAdded, onCancel }: { onAdded: (l: Link) => void; onCancel: () => void }) {
  const [columnGroup, setColumnGroup] = useState("");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!columnGroup.trim() || !label.trim() || !url.trim()) { setErr("Column name, label and URL are all required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ link: Link }>("/footer-links", {
        method: "POST",
        body: JSON.stringify({ label: label.trim(), url: url.trim(), column_group: columnGroup.trim().toLowerCase().replace(/\s+/g, "_"), opens_new_tab: false }),
      });
      onAdded(res.link);
    } catch (e: any) {
      setErr(e.message ?? "Failed to add.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-slate-700 p-3">
      <input type="text" value={columnGroup} onChange={(e) => setColumnGroup(e.target.value)} placeholder="Column name" className={inputClass + " w-32"} />
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="First link label" className={inputClass + " w-32"} />
      <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL" className={inputClass + " flex-1 min-w-[160px]"} />
      <button onClick={add} disabled={busy} className="rounded-lg bg-brand px-3 py-2 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50">
        {busy ? "Adding…" : "Add"}
      </button>
      <button onClick={onCancel} className="rounded-lg px-3 py-2 text-xs text-slate-500 hover:text-slate-300">Cancel</button>
      {err && <p className="w-full text-xs text-red-400">{err}</p>}
    </div>
  );
}
