import { Panel, selectClass, inputClass } from "../session/Panel";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExpiryAction = "archive" | "flag_for_review" | "hide_from_browse";

interface Props {
  expiresAt: string;
  expiryAction: ExpiryAction | "";
  onExpiresAt: (v: string) => void;
  onExpiryAction: (v: ExpiryAction | "") => void;
}

const ACTION_OPTIONS: { value: ExpiryAction | ""; label: string; note: string }[] = [
  { value: "", label: "No action", note: "Leave the course in its current state." },
  { value: "archive", label: "Archive", note: "Move the course to archived status." },
  { value: "flag_for_review", label: "Flag for review", note: "Notify the team to review the content." },
  { value: "hide_from_browse", label: "Hide from browse", note: "Keep accessible via direct link but remove from listings." },
];

// ─── FreshnessPanel ───────────────────────────────────────────────────────────

export function FreshnessPanel({ expiresAt, expiryAction, onExpiresAt, onExpiryAction }: Props) {
  const hasExpiry = !!expiresAt;

  return (
    <Panel
      title="Freshness & Expiry"
      description="Set an expiry date after which the course content is automatically managed."
    >
      <div className="space-y-4">
        {/* Expiry date */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            Content Expires At
          </label>
          <input
            type="datetime-local"
            className={inputClass}
            value={expiresAt}
            onChange={(e) => onExpiresAt(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-600">
            Leave blank for no expiry. When set, the expiry action triggers automatically.
          </p>
        </div>

        {/* Expiry action */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">
            On Expiry
            {!hasExpiry && <span className="ml-1 text-slate-600">(requires expiry date)</span>}
          </label>
          <select
            className={selectClass}
            value={expiryAction}
            onChange={(e) => onExpiryAction(e.target.value as ExpiryAction | "")}
            disabled={!hasExpiry}
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {expiryAction && (
            <p className="mt-1 text-xs text-slate-600">
              {ACTION_OPTIONS.find((o) => o.value === expiryAction)?.note}
            </p>
          )}
        </div>

        {/* Summary */}
        {hasExpiry && expiryAction && (
          <div className="rounded-lg bg-amber-900/20 border border-amber-800/50 px-3 py-2">
            <p className="text-xs text-amber-300">
              This course will be <strong>{expiryAction.replace(/_/g, " ")}</strong> after{" "}
              <strong>{new Date(expiresAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</strong>.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
