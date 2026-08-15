import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass, selectClass } from "../../components/session/Panel";

interface Ad {
  id: number;
  name: string | null;
  ad_type: "pre_roll" | "mid_roll" | null;
  video_url: string | null;
  click_url: string | null;
  duration_seconds: number | null;
  advertiser_id: number | null;
  is_active: boolean;
}

interface Advertiser {
  id: number;
  company_name: string | null;
}

interface FormState {
  name: string;
  ad_type: "pre_roll" | "mid_roll";
  video_url: string;
  click_url: string;
  duration_seconds: string;
  advertiser_id: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { name: "", ad_type: "pre_roll", video_url: "", click_url: "", duration_seconds: "", advertiser_id: "", is_active: true };

function toForm(a: Ad): FormState {
  return {
    name: a.name ?? "",
    ad_type: a.ad_type ?? "pre_roll",
    video_url: a.video_url ?? "",
    click_url: a.click_url ?? "",
    duration_seconds: a.duration_seconds != null ? String(a.duration_seconds) : "",
    advertiser_id: a.advertiser_id != null ? String(a.advertiser_id) : "",
    is_active: a.is_active,
  };
}

function AdSlideOver({ ad, advertisers, onClose, onSaved }: { ad: Ad | null; advertisers: Advertiser[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(ad ? toForm(ad) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const name = form.name.trim();
    if (!name) { setErr("A name is required."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      name,
      ad_type: form.ad_type,
      video_url: form.video_url.trim() || null,
      click_url: form.click_url.trim() || null,
      duration_seconds: form.duration_seconds.trim() ? Number(form.duration_seconds) : null,
      advertiser_id: form.advertiser_id ? Number(form.advertiser_id) : null,
      is_active: form.is_active,
    };
    try {
      if (ad) await api(`/ads/${ad.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/ads", { method: "POST", body: JSON.stringify(payload) });
      toast(`Ad ${ad ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save ad.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{ad ? "Edit Ad" : "Add Ad"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Name</label>
            <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} maxLength={150} />
            <p className="mt-1 text-xs text-slate-600">Shown as the option label in the pre-roll/mid-roll picker on the session and course editors.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Type</label>
              <select value={form.ad_type} onChange={(e) => set("ad_type", e.target.value as FormState["ad_type"])} className={selectClass}>
                <option value="pre_roll">Pre-roll</option>
                <option value="mid_roll">Mid-roll</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Duration (seconds)</label>
              <input type="number" min={1} value={form.duration_seconds} onChange={(e) => set("duration_seconds", e.target.value)} className={inputClass} placeholder="Optional" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Advertiser</label>
            <select value={form.advertiser_id} onChange={(e) => set("advertiser_id", e.target.value)} className={selectClass}>
              <option value="">— None —</option>
              {advertisers.map((a) => (
                <option key={a.id} value={a.id}>{a.company_name ?? `Advertiser #${a.id}`}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Video URL</label>
            <input type="text" value={form.video_url} onChange={(e) => set("video_url", e.target.value)} className={inputClass} maxLength={500} placeholder="Optional" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Click-through URL</label>
            <input type="text" value={form.click_url} onChange={(e) => set("click_url", e.target.value)} className={inputClass} maxLength={500} placeholder="Optional" />
          </div>

          <Toggle label="Active" description="Inactive ads drop out of the session/course editor's picker (they never showed a broken option once assigned)." checked={form.is_active} onChange={(v) => set("is_active", v)} />
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : ad ? "Save changes" : "Create ad"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Ads() {
  const { toast } = useToast();
  const [ads, setAds] = useState<Ad[] | null>(null);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Ad | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api<{ ads: Ad[] }>("/ads"), api<{ advertisers: Advertiser[] }>("/advertisers")])
      .then(([adsRes, advRes]) => { setAds(adsRes.ads); setAdvertisers(advRes.advertisers); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load ads.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const advertiserName = (id: number | null) => advertisers.find((a) => a.id === id)?.company_name ?? (id ? `Advertiser #${id}` : "—");

  async function handleDelete(ad: Ad) {
    if (!confirm(`Delete "${ad.name}"?`)) return;
    setDeletingId(ad.id);
    try {
      await api(`/ads/${ad.id}`, { method: "DELETE" });
      setAds((prev) => prev?.filter((a) => a.id !== ad.id) ?? null);
      toast("Ad deleted.");
    } catch (e: any) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nDeactivate instead?`)) {
          try {
            await api(`/ads/${ad.id}`, {
              method: "PUT",
              body: JSON.stringify({ ...ad, is_active: false }),
            });
            load();
            toast("Ad deactivated.");
          } catch (e2: any) {
            toast(e2.message ?? "Failed to deactivate.", "error");
          }
        }
      } else {
        toast(e.message ?? "Failed to delete ad.", "error");
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing && (
        <AdSlideOver ad={editing === "new" ? null : editing} advertisers={advertisers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Ads</h1>
          <p className="mt-1 text-sm text-slate-500">Pre-roll and mid-roll creative — the pool the session/course editor's Advertisement panel picks from.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="megaphone" className="h-4 w-4" />
          Add Ad
        </button>
      </div>

      {!ads?.length ? (
        <EmptyState icon={<Icon name="megaphone" className="h-6 w-6" />} heading="No ads yet" explanation="Create an ad here to make it selectable in the session/course editor's Advertisement panel." actionLabel="Add Ad" onAction={() => setEditing("new")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Advertiser</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {ads.map((a) => (
                  <tr key={a.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{a.name}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{a.ad_type?.replace("_", "-") ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{advertiserName(a.advertiser_id)}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{a.duration_seconds ? `${a.duration_seconds}s` : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${a.is_active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-500"}`}>
                        {a.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing(a)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
                        <button onClick={() => handleDelete(a)} disabled={deletingId === a.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                          {deletingId === a.id ? "…" : "Delete"}
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
