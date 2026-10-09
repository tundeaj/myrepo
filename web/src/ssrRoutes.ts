import { matchPath } from "react-router-dom";
import type { HeadTags } from "./lib/seo";
import { HOME_API_URL, homeHeadTags } from "./public/Home";
import { detailHeadTags, type DetailPayload } from "./public/Detail";
import {
  BROWSE_INDEX_API_URL,
  browseIndexHeadTags,
  browseCategoryApiUrl,
  browseCategoryHeadTags,
  type CategoryIndexPayload,
  type CategoryPayload,
} from "./public/Browse";
import { speakerApiUrl, speakerHeadTags, type SpeakerPayload } from "./public/SpeakerProfile";
import { staticPageApiUrl, staticPageHeadTags, type PagePayload } from "./public/StaticPage";
import { FAQS_API_URL, faqsHeadTags, type FaqsPayload } from "./public/Faqs";
import type { HomepagePayload } from "./public/lib/types";

/**
 * Server-only: matches a request path against the handful of public routes
 * that are worth SSR-ing for search visibility (Phase D — "SSR for public
 * pages that need it, skip logged-in screens"), fetches the same payload the
 * page's own client-side hook would, and derives the same head tags.
 *
 * Deliberately NOT every public route — /contact, /teach, /plans and
 * /community are left as plain SPA pages: a contact form and application
 * form have no indexable content of their own, and /community's content is
 * user-submitted and already behind moderation, not a search-acquisition
 * surface. Re-scope this list if that changes.
 */

export interface SsrResult {
  apiUrl: string;
  data: unknown;
  head: HeadTags;
  status: number;
}

export class SsrNotFoundError extends Error {}

const SSR_PATTERNS = ["/", "/watch/:slug", "/browse", "/browse/:slug", "/speakers/:slug", "/faqs", "/p/:slug"];

/** Cheap pre-check server.ts uses to decide SSR vs. the plain SPA shell —
 *  before spending a renderToString on, say, every /admin/* request. */
export function isSsrPath(pathname: string): boolean {
  return SSR_PATTERNS.some((pattern) => matchPath(pattern, pathname) !== null);
}

async function fetchApi<T>(apiBaseUrl: string, apiUrl: string): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${apiUrl}`);
  if (res.status === 404) throw new SsrNotFoundError(apiUrl);
  if (!res.ok) throw new Error(`SSR fetch failed (${res.status}): ${apiUrl}`);
  return res.json() as Promise<T>;
}

const NOT_FOUND_HEAD: HeadTags = { title: "Page not found" };

/**
 * Returns null for any path outside the SSR whitelist — the caller (server.ts)
 * falls back to the plain SPA shell for those, exactly like before this round.
 */
export async function loadSsrData(
  pathname: string,
  search: string,
  apiBaseUrl: string,
  origin: string,
): Promise<SsrResult | null> {
  if (pathname === "/") {
    const data = await fetchApi<HomepagePayload>(apiBaseUrl, HOME_API_URL);
    return { apiUrl: HOME_API_URL, data, head: homeHeadTags(data), status: 200 };
  }

  let match = matchPath("/watch/:slug", pathname);
  if (match?.params.slug) {
    const apiUrl = `/api/content/${encodeURIComponent(match.params.slug)}`;
    try {
      const data = await fetchApi<DetailPayload>(apiBaseUrl, apiUrl);
      return { apiUrl, data, head: detailHeadTags(data, origin), status: 200 };
    } catch (err) {
      if (err instanceof SsrNotFoundError) return { apiUrl, data: null, head: NOT_FOUND_HEAD, status: 404 };
      throw err;
    }
  }

  if (pathname === "/browse") {
    const data = await fetchApi<CategoryIndexPayload>(apiBaseUrl, BROWSE_INDEX_API_URL);
    return { apiUrl: BROWSE_INDEX_API_URL, data, head: browseIndexHeadTags(data), status: 200 };
  }

  match = matchPath("/browse/:slug", pathname);
  if (match?.params.slug) {
    const page = Math.max(1, Number(new URLSearchParams(search).get("page")) || 1);
    const apiUrl = browseCategoryApiUrl(match.params.slug, page);
    try {
      const data = await fetchApi<CategoryPayload>(apiBaseUrl, apiUrl);
      return { apiUrl, data, head: browseCategoryHeadTags(data), status: 200 };
    } catch (err) {
      if (err instanceof SsrNotFoundError) return { apiUrl, data: null, head: NOT_FOUND_HEAD, status: 404 };
      throw err;
    }
  }

  match = matchPath("/speakers/:slug", pathname);
  if (match?.params.slug) {
    const apiUrl = speakerApiUrl(match.params.slug);
    try {
      const data = await fetchApi<SpeakerPayload>(apiBaseUrl, apiUrl);
      return { apiUrl, data, head: speakerHeadTags(data), status: 200 };
    } catch (err) {
      if (err instanceof SsrNotFoundError) return { apiUrl, data: null, head: NOT_FOUND_HEAD, status: 404 };
      throw err;
    }
  }

  if (pathname === "/faqs") {
    const data = await fetchApi<FaqsPayload>(apiBaseUrl, FAQS_API_URL);
    return { apiUrl: FAQS_API_URL, data, head: faqsHeadTags(data), status: 200 };
  }

  match = matchPath("/p/:slug", pathname);
  if (match?.params.slug) {
    const apiUrl = staticPageApiUrl(match.params.slug);
    try {
      const data = await fetchApi<PagePayload>(apiBaseUrl, apiUrl);
      return { apiUrl, data, head: staticPageHeadTags(data), status: 200 };
    } catch (err) {
      if (err instanceof SsrNotFoundError) return { apiUrl, data: null, head: NOT_FOUND_HEAD, status: 404 };
      throw err;
    }
  }

  return null;
}
