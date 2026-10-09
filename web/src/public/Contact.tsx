import { useState } from "react";
import {
  usePublicData,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";
import { ApiRequestError } from "../lib/api";

type ContactPayload = PublicBootstrap;

const ENQUIRY_TYPES = [
  { value: "general", label: "General question" },
  { value: "corporate_training", label: "Corporate training" },
  { value: "speaking", label: "Speaking opportunity" },
  { value: "partnership", label: "Partnership" },
  { value: "support", label: "Support" },
];

const fieldClass = "w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand focus:outline-none";

/** /contact — the public form contact_requests had been waiting on since
 *  the original schema. POSTs straight to /api/public-contact with no
 *  admin session involved; the confirmation state is deliberately just
 *  "thanks, we got it" — the sender never sees their own status/notes
 *  fields, which are the admin inbox's business, not theirs. */
export function Contact() {
  const { data, error, loading, retry } = usePublicData<ContactPayload>("/api/public-contact");
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", enquiry_type: "general", message: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!form.message.trim()) { setErr("Enter a message."); return; }
    if (!form.email.trim() && !form.phone.trim()) { setErr("Leave an email or phone number so we can get back to you."); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/public-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          company: form.company.trim() || null,
          enquiry_type: form.enquiry_type,
          message: form.message.trim(),
          source_page: "/contact",
        }),
      });
      const parsed = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiRequestError(res.status, parsed.error ?? "Something went wrong. Try again.");
      setSent(true);
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-lg px-6 pb-16 pt-24">
        <h1 className="mb-2 text-2xl font-bold text-white">Get in touch</h1>
        <p className="mb-8 text-sm text-slate-500">Questions, corporate training, speaking or partnership enquiries — send a message and we'll get back to you.</p>

        {sent ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
            Thanks — your message has been sent. We'll get back to you soon.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className={fieldClass} placeholder="Name" maxLength={150} />
              <select value={form.enquiry_type} onChange={(e) => set("enquiry_type", e.target.value)} className={fieldClass}>
                {ENQUIRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={fieldClass} placeholder="Email" maxLength={190} />
              <input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={fieldClass} placeholder="Phone (optional)" maxLength={30} />
            </div>
            <input type="text" value={form.company} onChange={(e) => set("company", e.target.value)} className={fieldClass} placeholder="Company (optional)" maxLength={150} />
            <textarea value={form.message} onChange={(e) => set("message", e.target.value)} className={`${fieldClass} min-h-[140px]`} placeholder="How can we help?" maxLength={5000} />

            {err && <p className="text-sm text-red-400">{err}</p>}

            <button type="submit" disabled={busy} className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
              {busy ? "Sending…" : "Send message"}
            </button>
          </form>
        )}
      </div>
    </PublicShell>
  );
}
