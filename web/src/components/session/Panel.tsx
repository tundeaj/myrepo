import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  description?: string;
  children: ReactNode;
  error?: boolean;
  className?: string;
}

export function Panel({ title, description, children, error, className = "" }: PanelProps) {
  return (
    <div
      className={`rounded-xl border bg-slate-900/40 p-5 ${
        error ? "border-red-500" : "border-slate-800"
      } ${className}`}
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// Reusable field wrappers
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-400">
        {label}
        {required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
      <div className="relative mt-0.5 flex-shrink-0">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
        />
        <div
          className={`h-5 w-9 rounded-full transition-colors ${
            checked ? "bg-brand" : "bg-slate-700"
          }`}
        />
        <div
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </div>
      <div>
        <span className="text-sm text-slate-200">{label}</span>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none disabled:opacity-50";

export const selectClass =
  "w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none disabled:opacity-50";
