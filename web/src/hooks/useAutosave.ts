import { useEffect, useRef } from "react";

/**
 * Calls `saveFn` every `intervalMs` milliseconds, but only when `enabled` is true.
 * `saveFn` is captured in a ref so changes to it never reset the timer.
 */
export function useAutosave(
  saveFn: () => Promise<void> | void,
  enabled: boolean,
  intervalMs = 30_000,
) {
  const saveFnRef = useRef(saveFn);
  useEffect(() => { saveFnRef.current = saveFn; }, [saveFn]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => { void saveFnRef.current(); }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
