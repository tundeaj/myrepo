import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError } from "../lib/api";

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  correlationId: string | null;
  retry: () => void;
}

/** Fetches `path` on mount and whenever `deps` change. Loading/error states baked in
 * so every screen automatically gets the QUALITY STANDARD error+retry behaviour. */
export function useApi<T>(path: string | null, deps: unknown[] = []): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const fetchData = useCallback(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setCorrelationId(null);
    api<T>(path)
      .then((res) => setData(res))
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError) {
          setError(err.message);
          setCorrelationId(err.correlationId ?? null);
        } else {
          setError("Something went wrong. Please try again.");
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData, nonce]);

  return { data, loading, error, correlationId, retry: () => setNonce((n) => n + 1) };
}
