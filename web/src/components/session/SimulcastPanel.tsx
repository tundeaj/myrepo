import { useState } from "react";
import { Panel, Field, selectClass, inputClass, Toggle } from "./Panel";
import { api } from "../../lib/api";

export interface RestreamTarget {
  id?: number;
  platform: "youtube" | "facebook" | "x" | "linkedin";
  rtmp_url: string;
  stream_key: string; // entered by user (write-only from server perspective)
  stream_key_set?: boolean; // from server (indicates key was stored)
  is_enabled: boolean;
}

const PLATFORMS = [
  { value: "youtube", label: "YouTube Live" },
  { value: "facebook", label: "Facebook Live" },
  { value: "x", label: "X (Twitter)" },
  { value: "linkedin", label: "LinkedIn Live" },
];

interface Props {
  enabled: boolean;
  cutoffMinutes: string;
  targets: RestreamTarget[];
  onEnabled: (v: boolean) => void;
  onCutoffMinutes: (v: string) => void;
  onTargets: (targets: RestreamTarget[]) => void;
  sessionId?: number;
}

export function SimulcastPanel({
  enabled,
  cutoffMinutes,
  targets,
  onEnabled,
  onCutoffMinutes,
  onTargets,
  sessionId,
}: Props) {
  function addTarget() {
    onTargets([
      ...targets,
      { platform: "youtube", rtmp_url: "", stream_key: "", is_enabled: false },
    ]);
  }

  function updateTarget(idx: number, patch: Partial<RestreamTarget>) {
    onTargets(targets.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }

  function removeTarget(idx: number) {
    onTargets(targets.filter((_, i) => i !== idx));
  }

  return (
    <Panel title="Simulcast" description="Restream this session to additional platforms simultaneously.">
      <div className="space-y-4">
        <Toggle
          label="Enable simulcast"
          description="When ON, the stream will be sent to the platforms configured below."
          checked={enabled}
          onChange={onEnabled}
        />

        {enabled && (
          <>
            <Field label="Cut simulcast after (minutes)" hint="Leave blank to run until the session ends.">
              <input
                type="number"
                className={inputClass}
                min={1}
                value={cutoffMinutes}
                onChange={(e) => onCutoffMinutes(e.target.value)}
                placeholder="e.g. 90"
              />
            </Field>

            {targets.map((t, idx) => (
              <TargetRow
                key={idx}
                target={t}
                index={idx}
                sessionId={sessionId}
                onUpdate={(patch) => updateTarget(idx, patch)}
                onRemove={() => removeTarget(idx)}
              />
            ))}

            <button
              type="button"
              onClick={addTarget}
              className="flex items-center gap-1.5 text-sm text-brand hover:underline"
            >
              ＋ Add Platform
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}

// ─── TargetRow ────────────────────────────────────────────────────────────────
interface TargetRowProps {
  target: RestreamTarget;
  index: number;
  sessionId?: number;
  onUpdate: (patch: Partial<RestreamTarget>) => void;
  onRemove: () => void;
}

function TargetRow({ target, index, sessionId, onUpdate, onRemove }: TargetRowProps) {
  const [revealed, setRevealed] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  async function handleReveal() {
    if (!sessionId || !target.id) return;
    setRevealing(true);
    try {
      const res = await api<{ stream_key: string | null }>(
        `/sessions/${sessionId}/reveal-restream-key/${target.id}`,
        { method: "POST" },
      );
      setRevealedKey(res.stream_key);
      setRevealed(true);
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">Platform {index + 1}</span>
        <div className="flex items-center gap-3">
          <Toggle
            label="Enabled"
            checked={target.is_enabled}
            onChange={(v) => onUpdate({ is_enabled: v })}
          />
          <button
            type="button"
            onClick={onRemove}
            className="text-slate-600 hover:text-red-400"
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      </div>

      <Field label="Platform">
        <select
          className={selectClass}
          value={target.platform}
          onChange={(e) => onUpdate({ platform: e.target.value as RestreamTarget["platform"] })}
        >
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </Field>

      <Field label="RTMP URL">
        <input
          type="url"
          className={inputClass}
          value={target.rtmp_url}
          onChange={(e) => onUpdate({ rtmp_url: e.target.value })}
          placeholder="rtmps://live.example.com/stream"
        />
      </Field>

      <Field label="Stream Key">
        {/* When editing an existing saved target, show masked + reveal */}
        {target.id && target.stream_key_set && !revealed ? (
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
            <span className="flex-1 font-mono text-xs text-slate-500">{"•".repeat(24)}</span>
            <button
              type="button"
              disabled={revealing}
              onClick={handleReveal}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              {revealing ? "Revealing…" : "Reveal"}
            </button>
          </div>
        ) : (
          <input
            type={revealed ? "text" : "password"}
            className={inputClass}
            value={revealed ? revealedKey ?? target.stream_key : target.stream_key}
            onChange={(e) => onUpdate({ stream_key: e.target.value })}
            placeholder="Paste stream key from platform"
            autoComplete="off"
          />
        )}
      </Field>
    </div>
  );
}
