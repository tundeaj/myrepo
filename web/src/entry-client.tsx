import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./lib/AuthContext";
import { I18nProvider } from "./i18n/I18nProvider";
import { ToastProvider } from "./components/Toast";
import { SsrDataProvider, type SsrSlot } from "./lib/ssrData";
import "./index.css";

declare global {
  interface Window {
    __SSR_DATA__?: SsrSlot;
  }
}

const root = document.getElementById("root")!;
const ssrSlot = window.__SSR_DATA__ ?? null;

const tree = (
  <React.StrictMode>
    <BrowserRouter>
      <SsrDataProvider value={ssrSlot}>
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </I18nProvider>
      </SsrDataProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// A server-rendered page leaves real markup in #root; the plain SPA shell
// (every route outside the SSR whitelist — see ssrRoutes.ts) leaves it empty.
if (root.hasChildNodes()) {
  ReactDOM.hydrateRoot(root, tree, {
    // React already recovers from these on its own (falls back to a client
    // render for just that boundary) — this only changes where the report
    // goes, from an uncaught error to a plain console warning.
    onRecoverableError(error, errorInfo) {
      console.warn("[hydration] recovered:", error, errorInfo?.componentStack);
    },
  });
} else {
  ReactDOM.createRoot(root).render(tree);
}
