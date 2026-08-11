import { Panel, Toggle, inputClass } from "../session/Panel";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CertConfig {
  enabled: boolean;
  title: string;
  hours: string;
}

interface Props {
  cert: CertConfig;
  onChange: (cert: CertConfig) => void;
}

// ─── CertificationPanel ───────────────────────────────────────────────────────

export function CertificationPanel({ cert, onChange }: Props) {
  function patch(patch: Partial<CertConfig>) {
    onChange({ ...cert, ...patch });
  }

  return (
    <Panel
      title="Certification"
      description="Issue a certificate of completion to learners who finish all required lessons."
    >
      <div className="space-y-4">
        <Toggle
          label="Issue a certificate on completion"
          description="Learners who complete all required lessons will receive a downloadable certificate."
          checked={cert.enabled}
          onChange={(v) => patch({ enabled: v })}
        />

        {cert.enabled && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Certificate Title</label>
              <input
                className={inputClass}
                value={cert.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="e.g. Certificate of Completion"
                maxLength={150}
              />
              <p className="mt-1 text-xs text-slate-600">
                This appears as the certificate heading. Defaults to "Certificate of Completion".
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Hours of Instruction
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="w-28 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
                  min={0}
                  step={0.5}
                  value={cert.hours}
                  onChange={(e) => patch({ hours: e.target.value })}
                  placeholder="0"
                />
                <span className="text-sm text-slate-500">hours</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Shown on the certificate as instructional hours. Leave blank to omit.
              </p>
            </div>

            <div className="rounded-lg bg-slate-800/40 border border-slate-800 px-3 py-2.5">
              <p className="text-xs font-medium text-slate-300 mb-1">Certificate Preview</p>
              <p className="text-xs text-slate-500">
                This is to certify that <span className="text-slate-300">[Learner Name]</span> has
                successfully completed{" "}
                <span className="text-slate-300 italic">
                  {cert.title || "Certificate of Completion"}
                </span>
                {cert.hours ? ` (${cert.hours} hours of instruction)` : ""}.
              </p>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
