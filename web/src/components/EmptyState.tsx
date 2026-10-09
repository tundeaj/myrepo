import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  heading: string;
  explanation: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: "create" | "filtered";
}

/** Designed empty state — never a bare table header with no rows. */
export function EmptyState({ icon, heading, explanation, actionLabel, onAction, variant = "create" }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-12 text-center">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${variant === "create" ? "bg-brand/10 text-brand" : "bg-slate-800 text-slate-400"}`}>
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-slate-100">{heading}</h3>
      <p className="max-w-sm text-sm text-slate-400">{explanation}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className={
            variant === "create"
              ? "mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              : "mt-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          }
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
