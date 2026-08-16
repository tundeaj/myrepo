import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass } from "../../components/session/Panel";

interface SpeakerRow {
  id: number;
  full_name: string;
  slug: string;
  title: string | null;
  organisation: string | null;
  master_image_url: string | null;
  is_active: boolean;
  email?: string | null;
  phone?: string | null;
  speaker_type_id?: number | null;
  commission_pct?: string | number;
  payout_configured?: boolean;
  auto_approve?: boolean;
  created_at?: string;
}

interface SpeakerDetail extends SpeakerRow {
  bio: string | null;
  bio_fr: string | null;
  linkedin_url: string | null;
  account_number: string | null;
}

interface SpeakerType {
  id: number;
  name: string;
}

interface FormState {
  full_name: string;
  title: string;
  organisation: string;
  bio: string;
  master_image_url: string;
  linkedin_url: string;
  email: string;
  phone: string;
  speaker_type_id: string;
  commission_pct: string;
  auto_approve: boolean;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  full_name: "", title: "", organisation: "", bio: "", master_image_url: "", linkedin_url: "",
  email: "", phone: "", speaker_type_id: "", commission_pct: "0", auto_approve: false, is_active: true,
};

function speakerToForm(s: SpeakerDetail): FormState {
  return {
    full_name: s.full_name,
    title: s.title ?? "",
    organisation: s.organisation ?? "",
    bio: s.bio ?? "",
    master_image_url: s.master_image_url ?? "",
    linkedin_url: s.linkedin_url ?? "",
    email: s.email ?? "",
    phone: s.phone ?? "",
    speaker_type_id: s.speaker_type_id != null ? String(s.speaker_type_id) : "",
    commission_pct: String(s.commission_pct ?? "0"),
    auto_approve: Boolean(s.auto_approve),
    is_active: s.is_active,
  };
}

function SpeakerSlideOver({ speakerId, types, onClose, onSaved }: { speakerId: number | "new"; types: SpeakerType[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(speakerId === "new");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [payoutConfigured, setPayoutConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (speakerId === "new") return;
    api<{ speaker: SpeakerDetail }>(`/speakers/${speakerId}`)
      .then((res) => { setForm(speakerToForm(res.speaker)); setPayoutConfigured(Boolean(res.speaker.payout_configured)); setLoaded(true); })
      .catch((e: any) => setErr(e.message ?? "Failed to load speaker."));
  }, [speakerId]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const full_name = form.full_name.trim();
    if (!full_name) { setErr("A name is required."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      full_name,
      title: form.title.trim() || null,
      organisation: form.organisation.trim() || null,
      bio: form.bio.trim() || null,
      master_image_url: form.master_image_url.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      speaker_type_id: form.speaker_type_id ? Number(form.speaker_type_id) : null,
      commission_pct: Number(form.commission_pct) || 0,
      auto_approve: form.auto_approve,
      is_active: form.is_active,
    };
    try {
      if (speakerId === "new") {
        await api("/speakers", { method: "POST", body: JSON.stringify(payload) });
      } else {
        await api(`/speakers/${speakerId}`, { method: "PUT", body: JSON.stringify(payload) });
      }
      toast(`Speaker ${speakerId === "new" ? "created" : "updated"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save speaker.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{speakerId === "new" ? "Add Speaker" : "Edit Speaker"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        {!loaded ? (
          <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Full name</label>
                <input type="text" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} className={inputClass} maxLength={150} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Title</label>
                <input type="text" value={form.title} onChange={(e) => set("title", e.target.value)} className={inputClass} maxLength={150} placeholder="e.g. VP Growth" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Organisation</label>
              <input type="text" value={form.organisation} onChange={(e) => set("organisation", e.target.value)} className={inputClass} maxLength={150} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Email</label>
                <input type="text" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputClass} maxLength={190} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Phone</label>
                <input type="text" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputClass} maxLength={30} />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Bio</label>
              <textarea value={form.bio} onChange={(e) => set("bio", e.target.value)} className={`${inputClass} min-h-[80px]`} placeholder="Shown on the speaker's public page" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Photo URL</label>
                <input type="text" value={form.master_image_url} onChange={(e) => set("master_image_url", e.target.value)} className={inputClass} maxLength={500} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">LinkedIn URL</label>
                <input type="text" value={form.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} className={inputClass} maxLength={300} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Speaker type</label>
                <select value={form.speaker_type_id} onChange={(e) => set("speaker_type_id", e.target.value)} className={inputClass}>
                  <option value="">Unset</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-400">Default commission %</label>
                <input type="number" min={0} max={100} value={form.commission_pct} onChange={(e) => set("commission_pct", e.target.value)} className={inputClass} />
              </div>
            </div>

            {speakerId !== "new" && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
                Payout: {payoutConfigured ? <span className="text-emerald-400">bank details on file</span> : "not yet configured"} — set up through the instructor's own portal, not here.
              </div>
            )}

            <Toggle label="Auto-approve" description="Content this speaker is credited on skips the instructor review queue." checked={form.auto_approve} onChange={(v) => set("auto_approve", v)} />
            <Toggle label="Active" description="Inactive speakers are hidden from the session/course editor's picker, but keep their credit history." checked={form.is_active} onChange={(v) => set("is_active", v)} />

            {err && <p className="text-sm text-red-400">{err}</p>}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy || !loaded} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : speakerId === "new" ? "Create speaker" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Speakers() {
  const { toast } = useToast();
  const [speakers, setSpeakers] = useState<SpeakerRow[] | null>(null);
  const [types, setTypes] = useState<SpeakerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ speakers: SpeakerRow[] }>("/speakers?all=1&per_page=50")
      .then((res) => { setSpeakers(res.speakers); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load speakers.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<{ types: SpeakerType[] }>("/speakers/types").then((res) => setTypes(res.types)).catch(() => {}); }, []);

  async function handleDelete(speaker: SpeakerRow) {
    if (!confirm(`Delete "${speaker.full_name}"?`)) return;
    setDeletingId(speaker.id);
    try {
      await api(`/speakers/${speaker.id}`, { method: "DELETE" });
      setSpeakers((prev) => prev?.filter((s) => s.id !== speaker.id) ?? null);
      toast("Speaker deleted.");
    } catch (e: any) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nDeactivate instead?`)) {
          try {
            await api(`/speakers/${speaker.id}`, {
              method: "PUT",
              body: JSON.stringify({
                full_name: speaker.full_name, title: speaker.title, organisation: speaker.organisation,
                master_image_url: speaker.master_image_url, email: speaker.email ?? null, phone: speaker.phone ?? null,
                speaker_type_id: speaker.speaker_type_id ?? null, commission_pct: Number(speaker.commission_pct ?? 0),
                auto_approve: speaker.auto_approve ?? false, is_active: false,
              }),
            });
            load();
            toast("Speaker deactivated.");
          } catch (e2: any) {
            toast(e2.message ?? "Failed to deactivate.", "error");
          }
        }
      } else {
        toast(e.message ?? "Failed to delete speaker.", "error");
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing !== null && (
        <SpeakerSlideOver
          speakerId={editing}
          types={types}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Speakers</h1>
          <p className="mt-1 text-sm text-slate-500">Instructors and guest speakers credited on sessions and courses.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="mic" className="h-4 w-4" />
          Add Speaker
        </button>
      </div>

      {!speakers?.length ? (
        <EmptyState
          icon={<Icon name="mic" className="h-6 w-6" />}
          heading="No speakers yet"
          explanation="Speakers get credited on sessions and courses, and split revenue by commission_pct."
          actionLabel="Add Speaker"
          onAction={() => setEditing("new")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Organisation</th>
                  <th className="px-4 py-3 font-medium">Commission</th>
                  <th className="px-4 py-3 font-medium">Payout</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {speakers.map((s) => (
                  <tr key={s.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <button onClick={() => setEditing(s.id)} className="font-medium text-slate-100 hover:text-brand">{s.full_name}</button>
                      {s.title && <div className="text-xs text-slate-500">{s.title}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{s.organisation ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{s.commission_pct != null ? `${s.commission_pct}%` : "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{s.payout_configured ? <span className="text-emerald-400">Configured</span> : "Not set up"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${s.is_active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-500"}`}>
                        {s.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing(s.id)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
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
