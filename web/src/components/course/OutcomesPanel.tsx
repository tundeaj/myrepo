import { useState } from "react";
import { Panel } from "../session/Panel";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CourseOutcomes {
  objectives: string[];
  prerequisites: string[];
  target_audience: string[];
}

interface Props {
  outcomes: CourseOutcomes;
  onChange: (outcomes: CourseOutcomes) => void;
}

// ─── Chip list ─────────────────────────────────────────────────────────────────

interface ChipListProps {
  label: string;
  hint: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}

function ChipList({ label, hint, placeholder, items, onChange }: ChipListProps) {
  const [inputValue, setInputValue] = useState("");

  function commit(val: string) {
    const trimmed = val.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onChange([...items, trimmed]);
    setInputValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(inputValue);
    } else if (e.key === "Backspace" && !inputValue && items.length > 0) {
      onChange(items.slice(0, -1));
    }
  }

  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-0.5 block text-xs font-medium text-slate-400">{label}</label>
        <p className="text-xs text-slate-600">{hint}</p>
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, idx) => (
          <span
            key={idx}
            className="flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-200"
          >
            {item}
            <button
              type="button"
              onClick={() => remove(idx)}
              className="ml-0.5 text-slate-500 hover:text-red-400"
              aria-label={`Remove "${item}"`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {/* Input */}
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(inputValue)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand focus:outline-none"
      />
      <p className="text-xs text-slate-700">Press Enter or comma to add. Backspace removes the last chip.</p>
    </div>
  );
}

// ─── OutcomesPanel ─────────────────────────────────────────────────────────────

export function OutcomesPanel({ outcomes, onChange }: Props) {
  function patch(key: keyof CourseOutcomes, items: string[]) {
    onChange({ ...outcomes, [key]: items });
  }

  return (
    <Panel
      title="Learning Outcomes"
      description="Help prospective learners understand what they'll gain, need, and if this course is right for them."
    >
      <div className="space-y-5">
        <ChipList
          label="Learning Objectives"
          hint="What will learners be able to do by the end?"
          placeholder="e.g. Build a full-stack app with React and Node.js"
          items={outcomes.objectives}
          onChange={(items) => patch("objectives", items)}
        />

        <div className="border-t border-slate-800" />

        <ChipList
          label="Prerequisites / Requirements"
          hint="What should learners know or have before starting?"
          placeholder="e.g. Basic JavaScript knowledge"
          items={outcomes.prerequisites}
          onChange={(items) => patch("prerequisites", items)}
        />

        <div className="border-t border-slate-800" />

        <ChipList
          label="Who Is This For?"
          hint="Describe your ideal learner."
          placeholder="e.g. Marketers who want to learn data analytics"
          items={outcomes.target_audience}
          onChange={(items) => patch("target_audience", items)}
        />
      </div>
    </Panel>
  );
}
