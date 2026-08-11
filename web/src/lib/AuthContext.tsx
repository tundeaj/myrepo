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
    api<{ user: AuthUser }>("/auth/me")
      .then((res) => {
        setUser(res.user);
        setStatus("signed-in");
      })
      .catch(() => {
        setToken(null);
        setStatus("signed-out");
      });
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

  function logout() {
    setToken(null);
    setUser(null);
    setStatus("signed-out");
  }

  return <AuthContext.Provider value={{ user, status, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
