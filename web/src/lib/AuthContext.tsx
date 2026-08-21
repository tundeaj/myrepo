import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export interface AuthUser {
  id: number;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "viewer" | "instructor" | "admin" | "super_admin";
}

interface AuthContextValue {
  user: AuthUser | null;
  status: "loading" | "signed-in" | "signed-out";
  login: (email: string, password: string) => Promise<void>;
  /** Adopts a session the server just issued — registration, password reset and
   *  email verification all sign the user in without a second round trip. */
  adoptSession: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");

  useEffect(() => {
    if (!getToken()) {
      setStatus("signed-out");
      return;
    }

    // Deferred to idle so token verification never competes with a page's own
    // first-paint requests — the public homepage is allowed exactly two, and
    // this would otherwise be a third for any signed-in visitor. Protected
    // routes still gate on `status`, so nothing renders early as a result.
    let cancelled = false;
    const verify = () => {
      if (cancelled) return;
      api<{ user: AuthUser }>("/auth/me")
        .then((res) => {
          if (cancelled) return;
          setUser(res.user);
          setStatus("signed-in");
        })
        .catch(() => {
          if (cancelled) return;
          setToken(null);
          setStatus("signed-out");
        });
    };

    const win = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    const usedIdle = typeof win.requestIdleCallback === "function";
    const handle = usedIdle
      ? win.requestIdleCallback!(verify, { timeout: 2000 })
      : window.setTimeout(verify, 0);

    return () => {
      cancelled = true;
      if (usedIdle) win.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
  }, []);

  async function login(email: string, password: string) {
    const res = await api<{ token: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(res.token);
    setUser(res.user);
    setStatus("signed-in");
  }

  function adoptSession(token: string, nextUser: AuthUser) {
    setToken(token);
    setUser(nextUser);
    setStatus("signed-in");
  }

  function logout() {
    // Fire-and-forget: with stateless JWTs there is nothing to wait for, and a
    // failed call must never leave someone stuck looking signed in.
    api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setToken(null);
    setUser(null);
    setStatus("signed-out");
  }

  return (
    <AuthContext.Provider value={{ user, status, login, adoptSession, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
