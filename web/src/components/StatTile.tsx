import type { ReactNode } from "react";

interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
  icon?: ReactNode;
}

const TONE_STYLES: Record<NonNullable<StatTileProps["tone"]>, string> = {
  neutral: "text-slate-100",
  good: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400",
};

export function StatTile({ label, value, sublabel, tone = "neutral", icon }: StatTileProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${TONE_STYLES[tone]}`}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
    </div>
  );
}
