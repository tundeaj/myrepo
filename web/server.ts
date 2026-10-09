import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

/**
 * The web app's own server process — a NEW addition for Phase D's SSR item.
 * Before this, the web app had no Node server of its own at all: `vite`
 * served static assets in dev, and nothing served them in prod (no
 * Dockerfile/deploy config referenced the web package — see ROADMAP.md).
 * SSR needs a process that runs on every request, so this becomes that
 * process, replacing bare `vite`/`vite preview` in both dev and prod. It
 * calls the API server over HTTP exactly like the browser does — never
 * imports server/ code directly, so the two packages stay decoupled.
 *
 * Whitelisted public paths (see src/ssrRoutes.ts) get real server-rendered
 * HTML with real <title>/meta tags; everything else — the whole admin
 * console, the instructor portal, viewer account pages — gets the same
 * plain SPA shell this app has always served, unaffected by any of this.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 5173);
// Internal, server-to-server calls only — never exposed to the browser.
const API_BASE_URL = (process.env.API_BASE_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

async function createServer() {
  const app = express();

  let vite: import("vite").ViteDevServer | undefined;
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      root: __dirname,
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      "/",
      express.static(resolve(__dirname, "dist/client"), { index: false }),
    );
  }

  app.use("*", async (req, res) => {
    try {
      const url = req.originalUrl;
      const origin = `${req.protocol}://${req.get("host")}`;

      let template: string;
      let render: (url: string, apiBaseUrl: string, origin: string) => Promise<{
        html: string;
        head: string;
        dataScript: string;
        status: number;
      }>;
      let isSsrPath: (pathname: string) => boolean;

      if (!isProd) {
        template = readFileSync(resolve(__dirname, "index.html"), "utf-8");
        template = await vite!.transformIndexHtml(url, template);
        const mod = await vite!.ssrLoadModule("/src/entry-server.tsx");
        render = mod.render;
        isSsrPath = mod.isSsrPath;
      } else {
        template = readFileSync(resolve(__dirname, "dist/client/index.html"), "utf-8");
        // @ts-ignore — built at `npm run build`, not present during typecheck
        const mod = await import("./dist/server/entry-server.js");
        render = mod.render;
        isSsrPath = mod.isSsrPath;
      }

      const pathname = url.split("?")[0];
      if (!isSsrPath(pathname)) {
        // Plain SPA shell — identical to what bare `vite`/a static host served
        // before this file existed.
        const page = template.replace("<!--app-head-->", "").replace("<!--app-html-->", "").replace("<!--app-data-->", "");
        res.status(200).set({ "Content-Type": "text/html" }).send(page);
        return;
      }

      const { html, head, dataScript, status } = await render(url, API_BASE_URL, origin);
      const page = template
        .replace(/<title>.*?<\/title>\s*<!--app-head-->/s, head || "")
        .replace("<!--app-head-->", "")
        .replace("<!--app-html-->", html)
        .replace("<!--app-data-->", dataScript);

      res.status(status).set({ "Content-Type": "text/html" }).send(page);
    } catch (err) {
      if (!isProd && vite) vite.ssrFixStacktrace(err as Error);
      console.error("[web/server] request failed, serving plain shell:", err);
      try {
        const template = readFileSync(
          resolve(__dirname, isProd ? "dist/client/index.html" : "index.html"),
          "utf-8",
        );
        const page = template.replace("<!--app-head-->", "").replace("<!--app-html-->", "").replace("<!--app-data-->", "");
        res.status(200).set({ "Content-Type": "text/html" }).send(page);
      } catch {
        res.status(500).send("Internal server error");
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`[web/server] listening on http://127.0.0.1:${PORT} (${isProd ? "production" : "development"})`);
  });
}

createServer();
