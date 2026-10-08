import { useParams } from "react-router-dom";
import {
  usePublicData,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";

interface Page {
  title: string;
  title_fr: string | null;
  slug: string;
  body_html: string;
  body_html_fr: string | null;
  seo_title: string | null;
  seo_meta_description: string | null;
}

interface PagePayload extends PublicBootstrap {
  page: Page;
}

/** /p/:slug — a static page (About, Terms, Privacy, or a one-off marketing
 *  landing page). An unpublished or nonexistent slug both 404 identically
 *  server-side — see routes/pages.ts. */
export function StaticPage() {
  const { slug = "" } = useParams();
  const { data, error, loading, retry } = usePublicData<PagePayload>(`/api/public-pages/${encodeURIComponent(slug)}`);

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-24">
        <h1 className="mb-6 text-2xl font-bold text-white">{data.page.title}</h1>
        {/* body_html is admin-authored, not user-submitted — same trust
            boundary Faqs.tsx's answer_html already relies on. */}
        <div
          className="max-w-none text-sm leading-relaxed text-slate-400 [&_a]:text-brand [&_a]:underline [&_strong]:text-slate-200 [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-200 [&_p]:mb-3"
          dangerouslySetInnerHTML={{ __html: data.page.body_html }}
        />
      </div>
    </PublicShell>
  );
}
