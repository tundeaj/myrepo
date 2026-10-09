import { useEffect } from "react";

/**
 * A page's search/social identity: what SSR writes into the initial HTML
 * `<head>`, and what the client applies to the live `document` on every
 * client-side navigation (React Router never reloads the page, so nothing
 * else updates these after the first paint).
 */
export interface HeadTags {
  title: string;
  description?: string;
  canonical?: string;
  image?: string;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Server-only: the literal tags injected into index.html's `<!--app-head-->`. */
export function renderHeadHtml(tags: HeadTags): string {
  const parts = [`<title>${escapeAttr(tags.title)}</title>`];
  parts.push(`<meta property="og:type" content="website">`);
  parts.push(`<meta property="og:title" content="${escapeAttr(tags.title)}">`);
  if (tags.description) {
    parts.push(`<meta name="description" content="${escapeAttr(tags.description)}">`);
    parts.push(`<meta property="og:description" content="${escapeAttr(tags.description)}">`);
  }
  if (tags.canonical) {
    parts.push(`<link rel="canonical" href="${escapeAttr(tags.canonical)}">`);
    parts.push(`<meta property="og:url" content="${escapeAttr(tags.canonical)}">`);
  }
  if (tags.image) parts.push(`<meta property="og:image" content="${escapeAttr(tags.image)}">`);
  return parts.join("\n    ");
}

function upsertMeta(attr: "name" | "property", key: string, value: string): () => void {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  const created = !el;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  const previous = el.getAttribute("content");
  el.setAttribute("content", value);
  return () => {
    if (created) el!.remove();
    else if (previous === null) el!.removeAttribute("content");
    else el!.setAttribute("content", previous);
  };
}

function upsertCanonical(href: string): () => void {
  let el = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  const created = !el;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  const previous = el.getAttribute("href");
  el.setAttribute("href", href);
  return () => {
    if (created) el!.remove();
    else if (previous === null) el!.removeAttribute("href");
    else el!.setAttribute("href", previous);
  };
}

/**
 * Client-side equivalent of renderHeadHtml: applies the same tags to the live
 * document on mount/update, and restores whatever was there before on
 * cleanup — so navigating from a session page to the homepage never leaves
 * that session's title/description behind.
 */
export function useHeadTags(tags: HeadTags | null) {
  useEffect(() => {
    if (!tags || typeof document === "undefined") return;
    const previousTitle = document.title;
    document.title = tags.title;

    const restores: (() => void)[] = [
      upsertMeta("property", "og:type", "website"),
      upsertMeta("property", "og:title", tags.title),
    ];
    if (tags.description) {
      restores.push(upsertMeta("name", "description", tags.description));
      restores.push(upsertMeta("property", "og:description", tags.description));
    }
    if (tags.canonical) {
      restores.push(upsertCanonical(tags.canonical));
      restores.push(upsertMeta("property", "og:url", tags.canonical));
    }
    if (tags.image) restores.push(upsertMeta("property", "og:image", tags.image));

    return () => {
      document.title = previousTitle;
      restores.forEach((restore) => restore());
    };
  }, [tags]);
}
