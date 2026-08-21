import { Panel, Field, Toggle, inputClass } from "./Panel";
import { StatusBadge } from "../StatusBadge";
import type { ContentStatus } from "../StatusBadge";

interface Props {
  status: ContentStatus;
  publishMode: "immediate" | "scheduled";
  publishAt: string;
  isFeatured: boolean;
  showInHero: boolean;
  isActive: boolean;
  onPublishMode: (v: "immediate" | "scheduled") => void;
  onPublishAt: (v: string) => void;
  onIsFeatured: (v: boolean) => void;
  onShowInHero: (v: boolean) => void;
  onIsActive: (v: boolean) => void;
}

export function VisibilityPanel({
  status,
  publishMode,
  publishAt,
  isFeatured,
  showInHero,
  isActive,
  onPublishMode,
  onPublishAt,
  onIsFeatured,
  onShowInHero,
  onIsActive,
}: Props) {
  return (
    <Panel title="Visibility">
      <div className="space-y-4">
        {/* Current status */}
        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-slate-400">Current status</p>
            <p className="mt-0.5 text-xs text-slate-600">Status advances automatically based on scheduled times.</p>
          </div>
          <StatusBadge status={status} />
        </div>

        {/* Publish timing */}
        <Field label="Publication">
          <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="publish_mode"
                value="immediate"
                checked={publishMode === "immediate"}
                onChange={() => onPublishMode("immediate")}
                className="accent-brand"
              />
              <span className="text-sm text-slate-100">Publish immediately on save</span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="publish_mode"
                value="scheduled"
                checked={publishMode === "scheduled"}
                onChange={() => onPublishMode("scheduled")}
                className="mt-1 accent-brand"
              />
              <div className="flex-1">
                <span className="text-sm text-slate-100">Schedule publication</span>
                {publishMode === "scheduled" && (
                  <input
                    type="datetime-local"
                    className={`${inputClass} mt-2`}
                    value={publishAt}
                    onChange={(e) => onPublishAt(e.target.value)}
                  />
                )}
              </div>
            </label>
          </div>
        </Field>

        <div className="my-1 border-t border-slate-800" />

        <Toggle
          label="Feature this session"
          description="Pin to the top of the sessions list and mark with a featured badge."
          checked={isFeatured}
          onChange={onIsFeatured}
        />
        <Toggle
          label="Show in hero"
          description="Include in the homepage hero banner rotation."
          checked={showInHero}
          onChange={onShowInHero}
        />
        <Toggle
          label="Active"
          description="Inactive sessions are hidden from all public views."
          checked={isActive}
          onChange={onIsActive}
        />
      </div>
    </Panel>
  );
}
