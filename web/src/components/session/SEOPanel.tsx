import { Panel, Field, inputClass } from "./Panel";

interface Props {
  seoTitle: string;
  seoCanonicalUrl: string;
  seoMetaDescription: string;
  onSeoTitle: (v: string) => void;
  onSeoCanonicalUrl: (v: string) => void;
  onSeoMetaDescription: (v: string) => void;
}

export function SEOPanel({
  seoTitle,
  seoCanonicalUrl,
  seoMetaDescription,
  onSeoTitle,
  onSeoCanonicalUrl,
  onSeoMetaDescription,
}: Props) {
  const displayTitle = seoTitle || "Untitled session";
  const displayUrl = seoCanonicalUrl || "https://webinarflix.io/sessions/slug";
  const displayDesc = seoMetaDescription || "Add a meta description for better search visibility.";

  return (
    <Panel title="SEO" description="Control how this session appears in search engines.">
      <div className="space-y-4">
        <Field label="Page title" hint="Auto-filled from session title. 50–60 characters ideal.">
          <input
            type="text"
            className={inputClass}
            maxLength={200}
            value={seoTitle}
            onChange={(e) => onSeoTitle(e.target.value)}
            placeholder="Leave blank to use the session title"
          />
        </Field>

        <Field label="Canonical URL" hint="Override the default URL if this content is duplicated elsewhere.">
          <input
            type="url"
            className={inputClass}
            maxLength={300}
            value={seoCanonicalUrl}
            onChange={(e) => onSeoCanonicalUrl(e.target.value)}
            placeholder="https://webinarflix.io/sessions/my-session"
          />
        </Field>

        <Field label="Meta description" hint="140–160 characters ideal.">
          <textarea
            className={`${inputClass} resize-none`}
            maxLength={300}
            rows={3}
            value={seoMetaDescription}
            onChange={(e) => onSeoMetaDescription(e.target.value)}
            placeholder="A brief description of the session for search engines…"
          />
          <span className={`text-xs ${seoMetaDescription.length > 160 ? "text-amber-400" : "text-slate-600"}`}>
            {seoMetaDescription.length}/300
          </span>
        </Field>

        {/* Google result preview */}
        <div>
          <p className="mb-2 text-xs font-medium text-slate-400">Search result preview</p>
          <div className="rounded-lg border border-slate-800 bg-white/5 p-4">
            <p className="truncate text-base font-medium text-blue-400">{displayTitle}</p>
            <p className="truncate text-xs text-emerald-600">{displayUrl}</p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-400">{displayDesc}</p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
