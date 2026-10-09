import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import type { ReactElement } from "react";
import { StaticRouter } from "react-router-dom/server";
import { App } from "./App";
import { AuthProvider } from "./lib/AuthContext";
import { I18nProvider } from "./i18n/I18nProvider";
import { ToastProvider } from "./components/Toast";
import { SsrDataProvider, type SsrSlot } from "./lib/ssrData";
import { renderHeadHtml } from "./lib/seo";
import { loadSsrData, SsrNotFoundError, isSsrPath } from "./ssrRoutes";

export { isSsrPath };

/**
 * React's `lazy()` only renders synchronously once its dynamic import has
 * already resolved — otherwise `renderToString` throws, because it has no
 * support for suspending mid-render (that needs renderToPipeableStream).
 * The whitelisted routes' lazy chunks are a small, fixed set; warming them
 * here, on every request, makes SSR correct from this process's very first
 * request rather than only "working" once something else happened to load
 * the same chunk first.
 */
const warmLazyChunks = Promise.all([
  import("./public/Detail"),
  import("./public/Browse"),
  import("./public/SpeakerProfile"),
  import("./public/StaticPage"),
  import("./public/Faqs"),
]);

/**
 * `renderToString` has no support for Suspense — including the Suspense that
 * every lazy()-split route in App.tsx implicitly relies on — and either
 * throws or produces an incomplete page the first time a given chunk hasn't
 * resolved yet in this process. `renderToPipeableStream`'s `onAllReady`
 * waits for every boundary (including lazy imports) to actually settle, so
 * this only ever runs once the whole tree is real; buffering it into one
 * string trades true HTTP streaming for keeping server.ts's simple
 * string-template approach unchanged, which is the right trade for a sever
 * of only 6 whitelisted pages.
 */
function renderToStringAsync(element: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on("data", (chunk: Buffer) => chunks.push(chunk));
    sink.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    sink.on("error", reject);

    const { pipe } = renderToPipeableStream(element, {
      onAllReady() {
        pipe(sink);
      },
      onError(err) {
        reject(err);
      },
    });
  });
}

export interface RenderResult {
  html: string;
  head: string;
  /** A <script> tag seeding window.__SSR_DATA__, or "" when nothing was
   *  prefetched — entry-client.tsx reads it so hydration reuses the exact
   *  payload just rendered instead of re-fetching it immediately. */
  dataScript: string;
  status: number;
}

/** `<` is escaped so a `</script` sequence inside admin-authored rich text
 *  (an FAQ answer, a static page body) can never break out of the tag. */
function serializeSsrSlot(slot: SsrSlot): string {
  const json = JSON.stringify(slot).replace(/</g, "\\u003c");
  return `<script>window.__SSR_DATA__=${json};</script>`;
}

/**
 * Called once per request for a whitelisted public path (see ssrRoutes.ts).
 * `apiBaseUrl` is this process calling the API server directly (e.g.
 * http://127.0.0.1:4000) — the same endpoints the browser calls, just over an
 * internal URL instead of the public one. `origin` is the actual public
 * origin the request came in on, used only for canonical/og:url fallbacks.
 */
export async function render(url: string, apiBaseUrl: string, origin: string): Promise<RenderResult> {
  const [pathname, search = ""] = url.split("?");

  let slot: SsrSlot | null = null;
  let head = "";
  let status = 200;

  try {
    const result = await loadSsrData(pathname, search, apiBaseUrl, origin);
    if (result) {
      head = renderHeadHtml(result.head);
      status = result.status;
      if (result.data !== null) slot = { url: result.apiUrl, data: result.data };
    }
  } catch (err) {
    if (err instanceof SsrNotFoundError) {
      status = 404;
    } else {
      // Any other failure (API down, network blip) degrades to a plain,
      // un-prefetched render — the client's own fetch takes over on
      // hydration exactly like a visitor with JS and no SSR at all.
      console.error("[ssr] data load failed, falling back to client fetch:", err);
    }
  }

  await warmLazyChunks;

  const html = await renderToStringAsync(
    <StaticRouter location={url}>
      <SsrDataProvider value={slot}>
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </I18nProvider>
      </SsrDataProvider>
    </StaticRouter>,
  );

  return { html, head, dataScript: slot ? serializeSsrSlot(slot) : "", status };
}
