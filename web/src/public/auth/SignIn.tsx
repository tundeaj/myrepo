import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { AuthShell, fieldClass, submitClass, FormError, Label } from "./AuthShell";

/**
 * Viewer sign-in. Separate from /login, which is the back-office entry and
 * redirects into the admin console — wrong for someone who just wanted to watch
 * a webinar.
 */
export function SignIn() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Where to land afterwards: back to whatever the viewer was trying to reach.
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  if (status === "signed-in") return <Navigate to={from} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message ?? "We couldn't sign you in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back."
      footer={
        <>
          New here?{" "}
          <Link to="/register" state={{ from }} className="text-white underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />

        <div>
          <Label htmlFor="email">Email</Label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <Label htmlFor="password">Password</Label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
        </div>

        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <Link
          to="/forgot-password"
          className="block text-center text-xs text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthShell>
  );
}
