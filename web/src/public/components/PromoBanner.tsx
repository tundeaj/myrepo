import type { PublicPromotion } from "../lib/types";

/** The platform's own first-party marketing banner — distinct from a
 *  sponsor's paid placement (Hero.tsx's "Presented by" badge) and from a
 *  coupon code. Scoped to the homepage only; see homepageCache.ts's
 *  buildActivePromotion(). */
export function PromoBanner({ promotion }: { promotion: PublicPromotion | null }) {
  if (!promotion) return null;

  return (
    <div className="relative z-20 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-brand px-4 py-2 text-center text-sm text-white">
      <span className="font-semibold">{promotion.headline}</span>
      {promotion.body && <span className="text-white/90">{promotion.body}</span>}
      {promotion.link_url && (
        <a href={promotion.link_url} className="font-semibold underline underline-offset-2 hover:text-white/80">
          {promotion.link_label || "Learn more"}
        </a>
      )}
    </div>
  );
}
