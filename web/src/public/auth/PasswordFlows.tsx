import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { useAuth, type AuthUser } from "../../lib/AuthContext";
import { postPublic } from "../lib/publicPage";
import { AuthShell, fieldClass, submitClass, FormError, FormNotice, Label } from "./AuthShell";

const MIN_PASSWORD_LENGTH = 10;

// ─── /forgot-password ─────────────────────────────────────────────────────────

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await postPublic<{ message: string }>("/api/auth/forgot-password", { email });
      // The server answers identically whether or not the account exists, and so
      // does this page. Anything else here would undo that on the client.
      setSent(res.message);
    } catch (err: any) {
      setError(err?.message ?? "We couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" footer={<Link to="/signin" className="text-white underline-offset-4 hover:underline">Back to sign in</Link>}>
        <FormNotice message={sent} />
        <p className="mt-4 text-xs text-slate-500">
          The link works once and expires in an hour.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link to="/signin" className="text-white underline-offset-4 hover:underline">
          Back to sign in
        </Link>
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
        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthShell>
  );
}

// ─── /reset-password ──────────────────────────────────────────────────────────

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { adoptSession } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      const res = await postPublic<{ token: string; user: AuthUser }>("/api/auth/reset-password", {
        token,
        new_password: password,
      });
      // The server signs them in on success — completing a reset proves control
      // of the mailbox, so making them type the new password again is friction
      // with no security benefit.
      adoptSession(res.token, res.user);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.message ?? "We couldn't reset your password.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Reset your password" subtitle="That link looks incomplete.">
        <p className="text-sm text-slate-400">
          Open the link straight from the email, or{" "}
          <Link to="/forgot-password" className="text-white underline-offset-4 hover:underline">
            request a new one
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div>
          <Label htmlFor="password">New password</Label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={fieldClass}
          />
          <p className="mt-1 text-xs text-slate-600">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={fieldClass}
          />
        </div>
        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? "Saving…" : "Set new password"}
        </button>
      </form>
    </AuthShell>
  );
}

// ─── /verify-email ────────────────────────────────────────────────────────────

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { adoptSession } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState<"working" | "failed">("working");
  const [error, setError] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState("");
  const [resent, setResent] = useState<string | null>(null);

  // The token is single-use, and React 18 StrictMode mounts effects twice in
  // development — without this guard the second run consumes an already-consumed
  // token and reports a failure for a verification that actually succeeded.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) {
      if (!token) {
        setState("failed");
        setError("That confirmation link looks incomplete.");
      }
      return;
    }
    attempted.current = true;

    postPublic<{ token: string; user: AuthUser }>("/api/auth/verify-email", { token })
      .then((res) => {
        adoptSession(res.token, res.user);
        navigate("/", { replace: true });
      })
      .catch((err) => {
        setState("failed");
        setError(err?.message ?? "That confirmation link is no longer valid.");
      });
  }, [token, adoptSession, navigate]);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await postPublic<{ message: string }>("/api/auth/resend-verification", {
        email: resendEmail,
      });
      setResent(res.message);
    } catch (err: any) {
      setError(err?.message ?? "We couldn't send that. Try again.");
    }
  }

  if (state === "working") {
    return (
      <AuthShell title="Confirming your email" subtitle="One moment.">
        <div className="h-10 animate-pulse rounded-lg bg-slate-800/60" aria-busy />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="That link didn't work"
      footer={
        <Link to="/signin" className="text-white underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <FormError message={error} />
      {resent ? (
        <div className="mt-4">
          <FormNotice message={resent} />
        </div>
      ) : (
        <form onSubmit={resend} className="mt-4 space-y-3">
          <p className="text-sm text-slate-400">Enter your email and we'll send a fresh link.</p>
          <div>
            <Label htmlFor="resend">Email</Label>
            <input
              id="resend"
              type="email"
              required
              autoComplete="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              className={fieldClass}
            />
          </div>
          <button type="submit" className={submitClass}>
            Send a new link
          </button>
        </form>
      )}
    </AuthShell>
  );
}
