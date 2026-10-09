import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

// ─── Public instructor application page — no auth required.

const AUDIENCE_OPTIONS = [
  "Under 1,000",
  "1,000 – 10,000",
  "10,000 – 50,000",
  "50,000 – 250,000",
  "Over 250,000",
];

interface FormState {
  full_name: string;
  email: string;
  phone: string;
  expertise_areas: string;
  proposed_topics: string;
  linkedin_url: string;
  sample_video_url: string;
  audience_size: string;
}

const EMPTY: FormState = {
  full_name: "",
  email: "",
  phone: "",
  expertise_areas: "",
  proposed_topics: "",
  linkedin_url: "",
  sample_video_url: "",
  audience_size: "",
};

export function Teach() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.full_name.trim()) { setErr("Your name is required."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) { setErr("A valid email is required."); return; }
    if (!form.expertise_areas.trim()) { setErr("Tell us your areas of expertise."); return; }
    if (!form.proposed_topics.trim()) { setErr("Tell us what you'd like to teach."); return; }

    setBusy(true);
    try {
      const res = await api<{ message: string }>("/teach/apply", {
        method: "POST",
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || null,
          expertise_areas: form.expertise_areas.trim(),
          proposed_topics: form.proposed_topics.trim(),
          linkedin_url: form.linkedin_url.trim() || null,
          sample_video_url: form.sample_video_url.trim() || null,
          audience_size: form.audience_size || null,
        }),
      });
      setDone(res.message);
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 focus:border-brand focus:outline-none";
  const labelCls = "mb-1 block text-xs font-medium text-slate-400";

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800/60 px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">W</span>
          <span className="text-sm font-semibold text-slate-100">Webinarflix</span>
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {/* Pitch */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-100">Teach on Webinarflix</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-400">
            Share your expertise with learners across Nigeria, Ghana and West Africa.
            Run live sessions, publish courses, and earn from every learner you reach —
            we handle payments, streaming and the audience.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-6 text-center">
            {[
              { big: "₦", label: "Earn in Naira, paid monthly" },
              { big: "🎥", label: "We handle the streaming tech" },
              { big: "🌍", label: "Audience across West Africa" },
            ].map((item) => (
              <div key={item.label} className="w-40">
                <p className="text-xl">{item.big}</p>
                <p className="mt-1 text-xs text-slate-500">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {done ? (
          <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/30 p-6 text-center">
            <p className="text-2xl">🎉</p>
            <h2 className="mt-2 text-base font-semibold text-emerald-200">Application received</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-emerald-300/80">{done}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Full name *</label>
                <input type="text" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Email *</label>
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} placeholder="+234…" />
              </div>
              <div>
                <label className={labelCls}>Audience size</label>
                <select value={form.audience_size} onChange={(e) => set("audience_size", e.target.value)} className={inputCls}>
                  <option value="">Select…</option>
                  {AUDIENCE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Areas of expertise *</label>
              <input
                type="text"
                value={form.expertise_areas}
                onChange={(e) => set("expertise_areas", e.target.value)}
                className={inputCls}
                placeholder="e.g. Product management, fintech, data analytics"
              />
            </div>
            <div>
              <label className={labelCls}>What would you like to teach? *</label>
              <textarea
                rows={4}
                value={form.proposed_topics}
                onChange={(e) => set("proposed_topics", e.target.value)}
                className={inputCls}
                placeholder="Describe the sessions or courses you'd run, and who they're for."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls}>LinkedIn profile</label>
                <input type="url" value={form.linkedin_url} onChange={(e) => set("linkedin_url", e.target.value)} className={inputCls} placeholder="https://linkedin.com/in/…" />
              </div>
              <div>
                <label className={labelCls}>Sample video link</label>
                <input type="url" value={form.sample_video_url} onChange={(e) => set("sample_video_url", e.target.value)} className={inputCls} placeholder="YouTube, Vimeo or Drive link" />
              </div>
            </div>
            <p className="text-xs text-slate-600">
              A sample of you presenting — even a phone recording — strongly improves your application.
            </p>

            {err && <p className="text-sm text-red-400">{err}</p>}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy ? "Submitting…" : "Submit application"}
            </button>
            <p className="text-center text-xs text-slate-600">
              We review applications within 5 working days and reply by email either way.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
