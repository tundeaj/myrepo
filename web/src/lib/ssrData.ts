import { createContext, useContext } from "react";

/**
 * Carries exactly one prefetched API response from SSR into the first client
 * render — keyed by the same relative URL the page's own hook would otherwise
 * fetch, so a mismatch (wrong page, paginated/query-string change) is just
 * treated as "no SSR data" and falls back to a normal client fetch.
 *
 * One slot, not a map: every public route this app SSRs renders exactly one
 * page component, and that component makes exactly one bootstrap request.
 */
export interface SsrSlot {
  url: string;
  data: unknown;
}

export const SsrDataContext = createContext<SsrSlot | null>(null);
export const SsrDataProvider = SsrDataContext.Provider;

/** True, with the typed payload, only when `url` is exactly what SSR fetched. */
export function useSsrMatch<T>(url: string): T | null {
  const slot = useContext(SsrDataContext);
  if (!slot || slot.url !== url) return null;
  return slot.data as T;
}
