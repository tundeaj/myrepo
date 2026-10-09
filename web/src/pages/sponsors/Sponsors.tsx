import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass } from "../../components/session/Panel";
import { SponsorContentSlideOver } from "./SponsorContentSlideOver";

interface Sponsor {
  id: number;
  name: string | null;
  logo_url: string | null;
  website_url: string | null;
  contact_email: string | null;
  is_active: boolean;
}

interface FormState {
  name: string;
  logo_url: string;
  website_url: string;
  contact_email: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { name: "", logo_url: "", website_url: "", contact_email: "", is_active: true };

function toForm(s: Sponsor): FormState {
  return { name: s.name ?? "", logo_url: s.logo_url ?? "", website_url: s.website_url ?? "", contact_email: s.contact_email ?? "", is_active: s.is_active };
}

function SponsorSlideOver({ sponsor, onClose, onSaved }: { sponsor: Sponsor | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(sponsor ? toForm(sponsor) : EMPTY_FORM);
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
      logo_url: form.logo_url.trim() || null,
      website_url: form.website_url.trim() || null,
      contact_email: form.contact_email.trim() || null,
      is_active: form.is_active,
    };
    try {
      if (sponsor) await api(`/sponsors/${sponsor.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await api("/sponsors", { method: "POST", body: JSON.stringify(payload) });
      toast(`Sponsor ${sponsor ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save sponsor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{sponsor ? "Edit Sponsor" : "Add Sponsor"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Name</label>
            <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} maxLength={150} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Logo URL</label>
            <input type="text" value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} className={inputClass} maxLength={500} placeholder="Optional" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Website URL</label>
            <input type="text" value={form.website_url} onChange={(e) => set("website_url", e.target.value)} className={inputClass} maxLength={300} placeholder="Optional" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Contact email</label>
            <input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} className={inputClass} maxLength={190} placeholder="Optional" />
          </div>
          <Toggle label="Active" description="Inactive sponsors keep any existing content links but can't be assigned to new ones." checked={form.is_active} onChange={(v) => set("is_active", v)} />
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : sponsor ? "Save changes" : "Create sponsor"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sponsors() {
  const { toast } = useToast();
  const [sponsors, setSponsors] = useState<Sponsor[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Sponsor | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [contentFor, setContentFor] = useState<Sponsor | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ sponsors: Sponsor[] }>("/sponsors")
      .then((res) => { setSponsors(res.sponsors); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load sponsors.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(sponsor: Sponsor) {
    if (!confirm(`Delete "${sponsor.name}"?`)) return;
    setDeletingId(sponsor.id);
    try {
      await api(`/sponsors/${sponsor.id}`, { method: "DELETE" });
      setSponsors((prev) => prev?.filter((s) => s.id !== sponsor.id) ?? null);
      toast("Sponsor deleted.");
    } catch (e: any) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nDeactivate instead?`)) {
          try {
            await api(`/sponsors/${sponsor.id}`, { method: "PUT", body: JSON.stringify({ ...sponsor, is_active: false }) });
            load();
            toast("Sponsor deactivated.");
          } catch (e2: any) {
            toast(e2.message ?? "Failed to deactivate.", "error");
          }
        }
      } else {
        toast(e.message ?? "Failed to delete sponsor.", "error");
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
        <SponsorSlideOver sponsor={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {contentFor && (
        <SponsorContentSlideOver sponsorId={contentFor.id} sponsorName={contentFor.name} onClose={() => setContentFor(null)} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Sponsors</h1>
          <p className="mt-1 text-sm text-slate-500">Companies sponsoring specific content items.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="briefcase" className="h-4 w-4" />
          Add Sponsor
        </button>
      </div>

      {!sponsors?.length ? (
        <EmptyState icon={<Icon name="briefcase" className="h-6 w-6" />} heading="No sponsors yet" explanation="Add a sponsor to link to content." actionLabel="Add Sponsor" onAction={() => setEditing("new")} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Website</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {sponsors.map((s) => (
                  <tr key={s.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{s.name}</td>
                    <td className="px-4 py-3 text-slate-500">{s.website_url ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{s.contact_email ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${s.is_active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-500"}`}>
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setContentFor(s)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Content</button>
                        <button onClick={() => setEditing(s)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
                        <button onClick={() => handleDelete(s)} disabled={deletingId === s.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                          {deletingId === s.id ? "…" : "Delete"}
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
