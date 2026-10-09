interface ErrorStateProps {
  message: string;
  correlationId?: string | null;
  onRetry: () => void;
}

/** Inline error with cause + Retry. Never a silently-failed panel. */
export function ErrorState({ message, correlationId, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-900/40 bg-red-950/20 px-6 py-10 text-center">
      <p className="text-sm font-medium text-red-300">{message}</p>
      {correlationId && <p className="text-xs text-red-400/70">Reference: {correlationId}</p>}
      <button
        onClick={onRetry}
        className="rounded-lg border border-red-800 px-4 py-1.5 text-sm font-medium text-red-200 hover:bg-red-900/30"
      >
        Retry
      </button>
    </div>
  );
}
