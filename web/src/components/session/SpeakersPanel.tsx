import { useState, useEffect, useRef } from "react";
import { Panel, Field, inputClass, selectClass } from "./Panel";
import { api } from "../../lib/api";

export interface SessionSpeaker {
  speaker_id: number;
  role: "host" | "speaker" | "moderator" | "instructor" | "co_instructor" | "guest";
  revenue_share_pct: number;
  // denormalized for display:
  full_name?: string;
  title?: string;
  organisation?: string;
  master_image_url?: string;
}

interface SpeakerOption {
  id: number;
  full_name: string;
  title?: string;
  organisation?: string;
  master_image_url?: string;
}

const ROLES = ["host", "speaker", "moderator", "instructor", "co_instructor", "guest"] as const;
const ROLE_LABELS: Record<string, string> = {
  host: "Host",
  speaker: "Speaker",
  moderator: "Moderator",
  instructor: "Instructor",
  co_instructor: "Co-instructor",
  guest: "Guest",
};

interface Props {
  speakers: SessionSpeaker[];
  onChange: (speakers: SessionSpeaker[]) => void;
}

export function SpeakersPanel({ speakers, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SpeakerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const totalShare = speakers.reduce((sum, s) => sum + (s.revenue_share_pct || 0), 0);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleQueryChange(v: string) {
    setQuery(v);
    clearTimeout(searchTimer.current);
    if (!v.trim()) { setOptions([]); setShowDropdown(false); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api<{ speakers: SpeakerOption[] }>(`/speakers?q=${encodeURIComponent(v)}&per_page=10`);
        setOptions(res.speakers.filter((s) => !speakers.find((sel) => sel.speaker_id === s.id)));
        setShowDropdown(true);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function addSpeaker(opt: SpeakerOption) {
    onChange([
      ...speakers,
      {
        speaker_id: opt.id,
        role: "speaker",
        revenue_share_pct: 0,
        full_name: opt.full_name,
        title: opt.title,
        organisation: opt.organisation,
        master_image_url: opt.master_image_url,
      },
    ]);
    setQuery("");
    setShowDropdown(false);
  }

  function updateSpeaker(idx: number, patch: Partial<SessionSpeaker>) {
    onChange(speakers.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function removeSpeaker(idx: number) {
    onChange(speakers.filter((_, i) => i !== idx));
  }

  return (
    <Panel title="Speakers">
      <div className="space-y-4">
        {/* Search input */}
        <div className="relative" ref={dropdownRef}>
          <Field label="Add speakers">
            <div className="relative">
              <input
                className={inputClass}
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => options.length > 0 && setShowDropdown(true)}
                placeholder="Search by name or organisation…"
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  Searching…
                </span>
              )}
            </div>
          </Field>
          {showDropdown && options.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-800"
                  onMouseDown={() => addSpeaker(opt)}
                >
                  <Avatar url={opt.master_image_url} name={opt.full_name} size={8} />
                  <div>
                    <p className="text-sm font-medium text-slate-100">{opt.full_name}</p>
                    {(opt.title || opt.organisation) && (
                      <p className="text-xs text-slate-500">
                        {[opt.title, opt.organisation].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected speakers */}
        {speakers.length > 0 && (
          <div className="space-y-2">
            {speakers.map((s, idx) => (
              <div key={s.speaker_id} className="flex items-start gap-3 rounded-lg border border-slate-800 p-3">
                <Avatar url={s.master_image_url} name={s.full_name ?? "?"} size={10} />
                <div className="flex-1 space-y-2">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{s.full_name}</p>
                    {(s.title || s.organisation) && (
                      <p className="text-xs text-slate-500">
                        {[s.title, s.organisation].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Role</label>
                      <select
                        className={selectClass}
                        value={s.role}
                        onChange={(e) => updateSpeaker(idx, { role: e.target.value as any })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Revenue share %</label>
                      <input
                        type="number"
                        className={inputClass}
                        min={0}
                        max={100}
                        step={0.5}
                        value={s.revenue_share_pct}
                        onChange={(e) =>
                          updateSpeaker(idx, { revenue_share_pct: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeSpeaker(idx)}
                  className="ml-1 text-slate-600 hover:text-red-400"
                  aria-label="Remove speaker"
                >
                  ✕
                </button>
              </div>
            ))}
            {/* Running total */}
            <div
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                totalShare > 100
                  ? "bg-amber-900/30 text-amber-300"
                  : "bg-slate-800/60 text-slate-400"
              }`}
            >
              <span>Total revenue share</span>
              <span className="font-medium">
                {totalShare.toFixed(1)}%
                {totalShare > 100 && " ⚠ Above 100%"}
              </span>
            </div>
          </div>
        )}

        {/* Add new speaker */}
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 text-sm text-brand hover:underline"
        >
          ＋ New Speaker
        </button>
      </div>

      {showModal && (
        <NewSpeakerModal
          onClose={() => setShowModal(false)}
          onCreated={(sp) => {
            addSpeaker(sp);
            setShowModal(false);
          }}
        />
      )}
    </Panel>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ url, name, size }: { url?: string; name: string; size: number }) {
  const cls = `h-${size} w-${size} rounded-full object-cover bg-slate-700 flex-shrink-0 text-slate-400 flex items-center justify-center text-xs font-medium`;
  if (url) return <img src={url} alt={name} className={cls} />;
  return <div className={cls}>{name.charAt(0).toUpperCase()}</div>;
}

// ─── NewSpeakerModal ──────────────────────────────────────────────────────────
interface NewSpeakerModalProps {
  onClose: () => void;
  onCreated: (sp: SpeakerOption) => void;
}

function NewSpeakerModal({ onClose, onCreated }: NewSpeakerModalProps) {
  const [form, setForm] = useState({
    full_name: "",
    title: "",
    organisation: "",
    bio: "",
    master_image_url: "",
    linkedin_url: "",
    email: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ speaker: SpeakerOption }>("/speakers", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          title: form.title || null,
          organisation: form.organisation || null,
          bio: form.bio || null,
          master_image_url: form.master_image_url || null,
          linkedin_url: form.linkedin_url || null,
          email: form.email || null,
        }),
      });
      onCreated(res.speaker);
    } catch (err: any) {
      setError(err.message ?? "Failed to create speaker.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h3 className="font-semibold text-slate-100">New Speaker</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          <Field label="Full name" required>
            <input className={inputClass} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title / role">
              <input className={inputClass} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. CEO" />
            </Field>
            <Field label="Organisation">
              <input className={inputClass} value={form.organisation} onChange={(e) => set("organisation", e.target.value)} />
            </Field>
          </div>
          <Field label="Bio">
            <textarea className={`${inputClass} resize-none`} rows={3} value={form.bio} onChange={(e) => set("bio", e.target.value)} />
          </Field>
          <Field label="Headshot URL" hint="Paste a URL. ImageKit integration adds upload support.">
            <input className={inputClass} value={form.master_image_url} onChange={(e) => set("master_image_url", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="LinkedIn URL">
            <input className={inputClass} value={form.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/…" />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {saving ? "Creating…" : "Create Speaker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
