import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  variant: "success" | "error" | "info";
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastItem["variant"]) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let _nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, variant: ToastItem["variant"] = "success") => {
    const id = ++_nextId;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const remove = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Portal-less overlay — sits in DOM but positioned fixed */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              t.variant === "success"
                ? "bg-emerald-600 text-white"
                : t.variant === "error"
                ? "bg-red-600 text-white"
                : "bg-slate-700 text-slate-100"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              className="ml-2 text-white/70 hover:text-white"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
