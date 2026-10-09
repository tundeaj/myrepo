import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass } from "../../components/session/Panel";

interface Advertiser {
  id: number;
  company_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website_url: string | null;
  logo_url: string | null;
  notes: string | null;
  is_active: boolean;
}

interface FormState {
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  website_url: string;
  logo_url: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { company_name: "", contact_name: "", contact_email: "", contact_phone: "", website_url: "", logo_url: "", notes: "", is_active: true };

function toForm(a: Advertiser): FormState {
  return {
    company_name: a.company_name ?? "",
    contact_name: a.contact_name ?? "",
    contact_email: a.contact_email ?? "",
    contact_phone: a.contact_phone ?? "",
    website_url: a.website_url ?? "",
    logo_url: a.logo_url ?? "",
    notes: a.notes ?? "",
    is_active: a.is_active,
  };
}

function AdvertiserSlideOver({ advertiser, onClose, onSaved }: { advertiser: Advertiser | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(advertiser ? toForm(advertiser) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const company_name = form.company_name.trim();
    if (!company_name) { setErr("A company name is required."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      company_name,
      contact_name: form.contact_name.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      website_url: form.website_url.trim() || null,
      logo_url: form.logo_url.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };
    try {
      if (advertiser) await api(`/advertisers/${advertiser.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/advertisers", { method: "POST", body: JSON.stringify(payload) });
      toast(`Advertiser ${advertiser ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save advertiser.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{advertiser ? "Edit Advertiser" : "Add Advertiser"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Company name</label>
            <input type="text" value={form.company_name} onChange={(e) => set("company_name", e.target.value)} className={inputClass} maxLength={150} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Contact name</label>
              <input type="text" value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} className={inputClass} maxLength={150} placeholder="Optional" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Contact email</label>
              <input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} className={inputClass} maxLength={190} placeholder="Optional" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Contact phone</label>
              <input type="text" value={form.contact_phone} onChange={(e) => set("contact_phone", e.target.value)} className={inputClass} maxLength={30} placeholder="Optional" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Website URL</label>
              <input type="text" value={form.website_url} onChange={(e) => set("website_url", e.target.value)} className={inputClass} maxLength={300} placeholder="Optional" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Logo URL</label>
            <input type="text" value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} className={inputClass} maxLength={500} placeholder="Optional" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Notes</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={`${inputClass} min-h-[80px]`} placeholder="Internal notes, not shown publicly" />
          </div>
          <Toggle label="Active" description="Inactive advertisers keep their history but can't have new ads assigned." checked={form.is_active} onChange={(v) => set("is_active", v)} />
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : advertiser ? "Save changes" : "Create advertiser"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Advertisers() {
  const { toast } = useToast();
  const [advertisers, setAdvertisers] = useState<Advertiser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Advertiser | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ advertisers: Advertiser[] }>("/advertisers")
      .then((res) => { setAdvertisers(res.advertisers); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load advertisers.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(advertiser: Advertiser) {
    if (!confirm(`Delete "${advertiser.company_name}"?`)) return;
    setDeletingId(advertiser.id);
    try {
      await api(`/advertisers/${advertiser.id}`, { method: "DELETE" });
      setAdvertisers((prev) => prev?.filter((a) => a.id !== advertiser.id) ?? null);
      toast("Advertiser deleted.");
    } catch (e: any) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nDeactivate instead?`)) {
          try {
            await api(`/advertisers/${advertiser.id}`, { method: "PUT", body: JSON.stringify({ ...advertiser, is_active: false }) });
            load();
            toast("Advertiser deactivated.");
          } catch (e2: any) {
            toast(e2.message ?? "Failed to deactivate.", "error");
          }
        }
      } else {
        toast(e.message ?? "Failed to delete advertiser.", "error");
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
        <AdvertiserSlideOver advertiser={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Advertisers</h1>
          <p className="mt-1 text-sm text-slate-500">Companies buying ad placements on free-tier content.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="briefcase" className="h-4 w-4" />
          Add Advertiser
        </button>
      </div>

      {!advertisers?.length ? (
        <EmptyState icon={<Icon name="briefcase" className="h-6 w-6" />} heading="No advertisers yet" explanation="Add an advertiser before creating ads for them." actionLabel="Add Advertiser" onAction={() => setEditing("new")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Website</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {advertisers.map((a) => (
                  <tr key={a.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{a.company_name}</td>
                    <td className="px-4 py-3 text-slate-500">{a.contact_name ?? a.contact_email ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{a.website_url ?? "—"}</td>
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
