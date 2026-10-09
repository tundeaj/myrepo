import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Shared chrome for the five viewer auth pages. Deliberately not the PublicNav
 * shell: these pages have one job each, and a full navigation bar invites
 * wandering off mid-flow.
 */

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0b0b0f] px-6 py-12">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 block text-center text-lg font-bold tracking-tight text-white">
          Webinarflix
        </Link>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>

        {footer && <div className="mt-5 text-center text-sm text-slate-400">{footer}</div>}
      </div>
    </div>
  );
}

export const fieldClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none";

export const submitClass =
  "w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50";

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
    >
      {message}
    </div>
  );
}

export function FormNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
      {message}
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-slate-400">
      {children}
    </label>
  );
}
