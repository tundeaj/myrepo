import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { formatDateTimeLagos } from "../../lib/format";

type Status = "pending" | "approved" | "rejected";
type Kind = "post" | "comment";

interface Item {
  kind: Kind;
  id: number;
  body: string | null;
  status: Status;
  is_pinned?: boolean;
  created_at: string;
  author: { id: number; full_name: string | null; email: string } | null;
  space?: { id: number; name: string | null; slug: string } | null;
  parent_post?: { id: number; body: string | null; space_id: number } | null;
}

const TABS: Status[] = ["pending", "approved", "rejected"];

function itemKey(item: Item): string {
  return `${item.kind}:${item.id}`;
}

export function CommunityModeration() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("pending");
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    api<{ items: Item[] }>(`/community-moderation?status=${status}`)
      .then((res) => { setItems(res.items); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load the moderation queue.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function act(item: Item, next: "approved" | "rejected") {
    const key = itemKey(item);
    setActingKey(key);
    try {
      const path = item.kind === "post" ? `/community-moderation/posts/${item.id}` : `/community-moderation/comments/${item.id}`;
      await api(path, { method: "PUT", body: JSON.stringify({ status: next }) });
      setItems((prev) => prev?.filter((i) => itemKey(i) !== key) ?? null);
      setSelected((prev) => { const s = new Set(prev); s.delete(key); return s; });
      toast(next === "approved" ? `${item.kind === "post" ? "Post" : "Reply"} approved.` : `${item.kind === "post" ? "Post" : "Reply"} rejected.`);
    } catch (e: any) {
      toast(e.message ?? "Failed to update.", "error");
    } finally {
      setActingKey(null);
    }
  }

  async function remove(item: Item) {
    const label = item.kind === "post" ? "this post (and its replies)" : "this reply";
    if (!confirm(`Delete ${label}?`)) return;
    const key = itemKey(item);
    setActingKey(key);
    try {
      const path = item.kind === "post" ? `/community-moderation/posts/${item.id}` : `/community-moderation/comments/${item.id}`;
      await api(path, { method: "DELETE" });
      setItems((prev) => prev?.filter((i) => itemKey(i) !== key) ?? null);
      toast("Deleted.");
    } catch (e: any) {
      toast(e.message ?? "Failed to delete.", "error");
    } finally {
      setActingKey(null);
    }
  }

  async function togglePin(item: Item) {
    if (item.kind !== "post") return;
    const key = itemKey(item);
    setActingKey(key);
    try {
      const res = await api<{ post: { is_pinned: boolean } }>(`/community-moderation/posts/${item.id}/pin`, {
        method: "PUT",
        body: JSON.stringify({ is_pinned: !item.is_pinned }),
      });
      setItems((prev) => prev?.map((i) => (itemKey(i) === key ? { ...i, is_pinned: res.post.is_pinned } : i)) ?? null);
    } catch (e: any) {
      toast(e.message ?? "Failed to update.", "error");
    } finally {
      setActingKey(null);
    }
  }

  function toggleSelected(key: string) {
    setSelected((prev) => { const s = new Set(prev); if (s.has(key)) s.delete(key); else s.add(key); return s; });
  }

  const allSelected = items != null && items.length > 0 && selected.size === items.length;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(items?.map(itemKey) ?? []));
  }

  async function bulkAct(next: "approved" | "rejected") {
    const chosen = items?.filter((i) => selected.has(itemKey(i))) ?? [];
    if (!chosen.length) return;
    setBulkActing(true);
    try {
      const res = await api<{ results: { kind: Kind; id: number; ok: boolean; error?: string }[] }>(
        "/community-moderation/bulk",
        { method: "POST", body: JSON.stringify({ items: chosen.map((i) => ({ kind: i.kind, id: i.id })), status: next }) },
      );
      const succeeded = new Set(res.results.filter((r) => r.ok).map((r) => `${r.kind}:${r.id}`));
      setItems((prev) => prev?.filter((i) => !succeeded.has(itemKey(i))) ?? null);
      setSelected((prev) => { const s = new Set(prev); for (const k of succeeded) s.delete(k); return s; });
      const failedCount = res.results.length - succeeded.size;
      const verb = next === "approved" ? "approved" : "rejected";
      if (failedCount) {
        toast(`${succeeded.size} ${verb}, ${failedCount} failed.`, succeeded.size ? "info" : "error");
      } else {
        toast(`${succeeded.size} item${succeeded.size === 1 ? "" : "s"} ${verb}.`);
      }
    } catch (e: any) {
      toast(e.message ?? "Bulk update failed.", "error");
    } finally {
      setBulkActing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Posts &amp; Moderation</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every post and reply across every Community Space starts here — nothing shows on the public site until it's approved.
        </p>
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setStatus(t)}
            className={`rounded-full border px-3 py-1 text-xs capitalize ${status === t ? "border-brand bg-brand/15 text-brand" : "border-slate-800 text-slate-500 hover:text-slate-300"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={load} />
      ) : !items?.length ? (
        <EmptyState icon={<Icon name="shield" className="h-6 w-6" />} heading={`No ${status} items`} explanation={status === "pending" ? "Nothing is waiting for review." : `Nothing has been ${status} yet.`} />
      ) : (
        <div className="space-y-3">
          {status === "pending" && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2.5">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-900" />
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </label>
              {selected.size > 0 && (
                <div className="ml-auto flex gap-2">
                  <button onClick={() => bulkAct("approved")} disabled={bulkActing} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
                    Approve {selected.size}
                  </button>
                  <button onClick={() => bulkAct("rejected")} disabled={bulkActing} className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                    Reject {selected.size}
                  </button>
                </div>
              )}
            </div>
          )}
          {items.map((item) => {
            const key = itemKey(item);
            return (
              <div key={key} className="rounded-xl border border-slate-800 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    {status === "pending" && (
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleSelected(key)}
                        className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-slate-700 bg-slate-900"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${item.kind === "post" ? "border-sky-500/30 bg-sky-500/10 text-sky-300" : "border-violet-500/30 bg-violet-500/10 text-violet-300"}`}>
                          {item.kind === "post" ? "Post" : "Reply"}
                        </span>
                        <span className="text-slate-500">{item.author?.full_name ?? item.author?.email ?? "Unknown"}</span>
                        <span className="text-slate-700">·</span>
                        <span className="truncate text-slate-500">
                          {item.kind === "post" ? item.space?.name ?? "Unknown space" : `reply to post #${item.parent_post?.id}`}
                        </span>
                        {item.is_pinned && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">Pinned</span>}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{item.body}</p>
                      <p className="mt-2 text-xs text-slate-600">{formatDateTimeLagos(item.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {status === "pending" && (
                      <>
                        <button onClick={() => act(item, "approved")} disabled={actingKey === key} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
                          Approve
                        </button>
                        <button onClick={() => act(item, "rejected")} disabled={actingKey === key} className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50">
                          Reject
                        </button>
                      </>
                    )}
                    {status === "approved" && item.kind === "post" && (
                      <button onClick={() => togglePin(item)} disabled={actingKey === key} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50">
                        {item.is_pinned ? "Unpin" : "Pin"}
                      </button>
                    )}
                    <button onClick={() => remove(item)} disabled={actingKey === key} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
