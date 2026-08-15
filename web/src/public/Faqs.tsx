import { useState } from "react";
import {
  usePublicData,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";

interface Faq {
  id: number;
  question: string | null;
  answer_html: string | null;
  category: string | null;
  display_order: number | null;
  views: number;
  helpful_yes: number;
  helpful_no: number;
}

interface FaqsPayload extends PublicBootstrap {
  faqs: Faq[];
}

/** One question. Tracks its own expanded state and, the first time it's
 *  actually opened, fires the view-count webhook — a person scrolling past
 *  a collapsed question never counted as having "viewed" it. */
function FaqRow({ faq }: { faq: Faq }) {
  const [open, setOpen] = useState(false);
  const [viewed, setViewed] = useState(false);
  const [voted, setVoted] = useState<"yes" | "no" | null>(null);
  const [counts, setCounts] = useState({ helpful_yes: faq.helpful_yes, helpful_no: faq.helpful_no });

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !viewed) {
      setViewed(true);
      fetch(`/api/public-faqs/${faq.id}/view`, { method: "POST" }).catch(() => {});
    }
  }

  async function vote(helpful: boolean) {
    if (voted) return;
    setVoted(helpful ? "yes" : "no");
    setCounts((c) => (helpful ? { ...c, helpful_yes: c.helpful_yes + 1 } : { ...c, helpful_no: c.helpful_no + 1 }));
    try {
      await fetch(`/api/public-faqs/${faq.id}/helpful`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ helpful }),
      });
    } catch {
      // A failed vote just doesn't persist server-side — the optimistic tick
      // already gave the visitor the "thanks" feeling, and re-showing the
      // buttons for a retry would be a worse experience than a vote that
      // silently didn't count.
    }
  }

  return (
    <div className="border-b border-slate-800 py-4">
      <button onClick={toggle} className="flex w-full items-center justify-between gap-4 text-left">
        <span className="text-sm font-medium text-slate-100">{faq.question}</span>
        <span className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {/* answer_html is admin-authored, not user-submitted — same trust
              boundary as every other admin-typed rich-text field in this
              app (e.g. Category.description elsewhere on the public site). */}
          <div className="max-w-none text-sm leading-relaxed text-slate-400 [&_a]:text-brand [&_a]:underline [&_strong]:text-slate-200" dangerouslySetInnerHTML={{ __html: faq.answer_html ?? "" }} />
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>Was this helpful?</span>
            <button
              onClick={() => vote(true)}
              disabled={voted != null}
              className={`rounded border px-2 py-0.5 ${voted === "yes" ? "border-emerald-500/40 text-emerald-300" : "border-slate-700 hover:text-slate-300"} disabled:cursor-default`}
            >
              Yes ({counts.helpful_yes})
            </button>
            <button
              onClick={() => vote(false)}
              disabled={voted != null}
              className={`rounded border px-2 py-0.5 ${voted === "no" ? "border-red-500/40 text-red-300" : "border-slate-700 hover:text-slate-300"} disabled:cursor-default`}
            >
              No ({counts.helpful_no})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** /faqs — every published global FAQ, grouped by category (uncategorised
 *  ones fall under "General"). Content-scoped FAQs don't appear here — see
 *  the FAQ section on the content detail page instead. */
export function Faqs() {
  const { data, error, loading, retry } = usePublicData<FaqsPayload>("/api/public-faqs");

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  const groups = new Map<string, Faq[]>();
  for (const faq of data.faqs) {
    const key = faq.category?.trim() || "General";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(faq);
  }

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-24">
        <h1 className="mb-2 text-2xl font-bold text-white">Frequently asked questions</h1>
        <p className="mb-8 text-sm text-slate-500">Can't find what you're looking for? Reach out through the contact page.</p>

        {!data.faqs.length ? (
          <p className="text-sm text-slate-500">No questions published yet.</p>
        ) : (
          [...groups.entries()].map(([category, faqs]) => (
            <div key={category} className="mb-8">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{category}</h2>
              <div>
                {faqs.map((faq) => (
                  <FaqRow key={faq.id} faq={faq} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </PublicShell>
  );
}
