import { useParams, Link, useSearchParams } from "react-router-dom";
import { buildImageUrl } from "./lib/images";
import {
  usePublicData,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";
import { Card } from "./components/Card";
import type { ContentCard } from "./lib/types";

interface Category {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
}

interface CategoryIndexPayload extends PublicBootstrap {
  categories: Category[];
}

interface CategoryPayload extends PublicBootstrap {
  category: Category;
  items: ContentCard[];
  page: number;
  total: number;
}

const PER_PAGE = 24;

/** /browse — every category as a tile. The destination for a homepage tile row
 *  when the row itself has no category slug to point at. */
export function BrowseIndex() {
  const { data, error, loading, retry } = usePublicData<CategoryIndexPayload>(
    "/api/public-categories",
  );

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-24">
        <h1 className="mb-6 text-2xl font-bold text-white">Browse</h1>
        {!data.categories.length ? (
          <p className="text-sm text-slate-500">No categories yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {data.categories.map((c) => (
              <Link
                key={c.id}
                to={c.slug ? `/browse/${c.slug}` : "#"}
                className="group relative aspect-video overflow-hidden rounded-lg bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                {c.image_url && (
                  <img
                    src={buildImageUrl(c.image_url, 420) ?? undefined}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
                <span className="absolute inset-x-3 bottom-3 text-sm font-semibold text-white">
                  {c.name}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}

/** /browse/:slug — one category, paginated. */
export function BrowseCategory() {
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);

  const { data, error, loading, retry } = usePublicData<CategoryPayload>(
    `/api/public-categories/${encodeURIComponent(slug)}?page=${page}`,
  );

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  const lastPage = Math.max(1, Math.ceil(data.total / PER_PAGE));

  return (
    <PublicShell boot={data}>
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-24">
        <nav className="mb-3 text-xs text-slate-500">
          <Link to="/browse" className="hover:text-slate-300">
            Browse
          </Link>
          <span className="mx-2 text-slate-700">/</span>
          <span className="text-slate-400">{data.category.name}</span>
        </nav>

        <h1 className="text-2xl font-bold text-white">{data.category.name}</h1>
        {data.category.description && (
          <p className="mt-2 max-w-2xl text-sm text-slate-400">{data.category.description}</p>
        )}
        <p className="mt-1 text-xs text-slate-600">
          {data.total} {data.total === 1 ? "item" : "items"}
        </p>

        {/* Flex-wrap rather than a grid: Card carries the fixed widths the
            carousel needs, and a grid cell would fight them. */}
        {!data.items.length ? (
          <p className="mt-10 text-sm text-slate-500">Nothing published in this category yet.</p>
        ) : (
          <div className="mt-6 flex flex-wrap gap-4">
            {data.items.map((item) => (
              <Card key={item.id} item={item} variant="poster" kind="content" />
            ))}
          </div>
        )}

        {lastPage > 1 && (
          <div className="mt-10 flex items-center justify-center gap-3">
            <button
              disabled={page <= 1}
              onClick={() => setParams({ page: String(page - 1) })}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {page} of {lastPage}
            </span>
            <button
              disabled={page >= lastPage}
              onClick={() => setParams({ page: String(page + 1) })}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
