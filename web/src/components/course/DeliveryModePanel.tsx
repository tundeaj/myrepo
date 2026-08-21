import { Panel, inputClass } from "../session/Panel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  isCohort: boolean;
  cohortStartDate: string;
  onIsCohort: (v: boolean) => void;
  onCohortStartDate: (v: string) => void;
}

// ─── DeliveryModePanel ────────────────────────────────────────────────────────

export function DeliveryModePanel({ isCohort, cohortStartDate, onIsCohort, onCohortStartDate }: Props) {
  return (
    <Panel
      title="Delivery Mode"
      description="Choose how learners progress through this course."
    >
      <div className="space-y-4">
        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onIsCohort(false)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              !isCohort
                ? "border-brand bg-brand/10"
                : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
            }`}
          >
            <div className="mb-1 text-lg">🎓</div>
            <p className={`text-sm font-medium ${!isCohort ? "text-brand" : "text-slate-200"}`}>
              Self-Paced
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Learners enrol and start whenever they like. Drip unlocks by days after enrolment.
            </p>
          </button>

          <button
            type="button"
            onClick={() => onIsCohort(true)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              isCohort
                ? "border-brand bg-brand/10"
                : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
            }`}
          >
            <div className="mb-1 text-lg">👥</div>
            <p className={`text-sm font-medium ${isCohort ? "text-brand" : "text-slate-200"}`}>
              Cohort
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              All learners start together on a fixed date. Drip unlocks by days after the cohort start.
            </p>
          </button>
        </div>

        {/* Cohort start date */}
        {isCohort && (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Cohort Start Date</label>
            <input
              type="date"
              className={inputClass}
              value={cohortStartDate}
              onChange={(e) => onCohortStartDate(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-600">
              Module drip days are counted from this date. All enrolled learners start together.
            </p>
          </div>
        )}

        {/* Info callout */}
        <div className="rounded-lg bg-slate-800/40 px-3 py-2.5 text-xs text-slate-400">
          {isCohort ? (
            <>
              <span className="font-medium text-slate-300">Cohort mode:</span> learners who enrol before
              the start date receive access on {cohortStartDate || "the cohort date"}. Module drip is
              relative to the cohort start, not individual enrolment.
            </>
          ) : (
            <>
              <span className="font-medium text-slate-300">Self-paced mode:</span> learners enrol any
              time and unlock modules according to their individual drip schedule (days after enrolment).
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
