const TOKEN_KEY = "webinarflix_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiRequestError extends Error {
  status: number;
  correlationId?: string;
  constructor(status: number, message: string, correlationId?: string) {
    super(message);
    this.status = status;
    this.correlationId = correlationId;
  }
}

/**
 * Thin fetch wrapper. Every caller gets a plain-English Error on failure —
 * never a raw fetch/network exception bubbling into a component.
 */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch {
    throw new ApiRequestError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    let correlationId: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
      correlationId = body?.correlationId;
    } catch {
      // response wasn't JSON — keep the generic message rather than leak raw text
    }
    throw new ApiRequestError(res.status, message, correlationId);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
