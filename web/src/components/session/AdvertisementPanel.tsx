import { useEffect } from "react";
import { Panel, Field, selectClass, inputClass } from "./Panel";
import { useApi } from "../../hooks/useApi";

interface Ad {
  id: number;
  name: string;
  duration_seconds?: number;
}

interface Props {
  accessLevel: string;
  preRollAdId: number | null;
  midRollAdId: number | null;
  midRollOffsetSeconds: number | null;
  onPreRollAdId: (id: number | null) => void;
  onMidRollAdId: (id: number | null) => void;
  onMidRollOffsetSeconds: (secs: number | null) => void;
}

const PAID_ACCESS = ["subscriber", "purchase", "cohort"];

function secsToHMS(secs: number | null): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function hmsToSecs(hms: string): number | null {
  const parts = hms.split(":").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function AdvertisementPanel({
  accessLevel,
  preRollAdId,
  midRollAdId,
  midRollOffsetSeconds,
  onPreRollAdId,
  onMidRollAdId,
  onMidRollOffsetSeconds,
}: Props) {
  const adsState = useApi<{ pre_roll: Ad[]; mid_roll: Ad[] }>("/ai/ads");
  const isPaid = PAID_ACCESS.includes(accessLevel);

  // Hard rule: clear ads when content becomes paid
  useEffect(() => {
    if (isPaid) {
      if (preRollAdId !== null) onPreRollAdId(null);
      if (midRollAdId !== null) onMidRollAdId(null);
      if (midRollOffsetSeconds !== null) onMidRollOffsetSeconds(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaid]);

  return (
    <div className={`relative ${isPaid ? "opacity-60" : ""}`}>
      <Panel title="Advertisement" description="Assign pre-roll or mid-roll ads to this session.">
        {isPaid && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-900/20 p-3">
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-xs text-amber-300">
              Ads are not served on paid or subscriber content. This panel is disabled.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <Field label="Pre-roll ad">
            <select
              className={selectClass}
              disabled={isPaid}
              value={preRollAdId ?? ""}
              onChange={(e) => onPreRollAdId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— None —</option>
              {(adsState.data?.pre_roll ?? []).map((ad) => (
                <option key={ad.id} value={ad.id}>
                  {ad.name}
                  {ad.duration_seconds ? ` (${ad.duration_seconds}s)` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Mid-roll ad">
            <select
              className={selectClass}
              disabled={isPaid}
              value={midRollAdId ?? ""}
              onChange={(e) => onMidRollAdId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— None —</option>
              {(adsState.data?.mid_roll ?? []).map((ad) => (
                <option key={ad.id} value={ad.id}>
                  {ad.name}
                  {ad.duration_seconds ? ` (${ad.duration_seconds}s)` : ""}
                </option>
              ))}
            </select>
          </Field>

          {midRollAdId && !isPaid && (
            <Field label="Mid-roll position (HH:MM:SS)">
              <input
                type="text"
                className={inputClass}
                pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                placeholder="00:30:00"
                value={secsToHMS(midRollOffsetSeconds)}
                onChange={(e) => onMidRollOffsetSeconds(hmsToSecs(e.target.value))}
              />
            </Field>
          )}
        </div>
      </Panel>
      {isPaid && <div className="absolute inset-0 rounded-xl cursor-not-allowed" />}
    </div>
  );
}
