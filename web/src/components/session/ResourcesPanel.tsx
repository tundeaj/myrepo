import { Panel, Toggle, inputClass } from "./Panel";

export interface Resource {
  id?: number;
  title: string;
  file_url: string;
  file_type: string;
  file_size_kb?: number;
  requires_entitlement: boolean;
}

const ACCEPTED = ".pdf,.docx,.pptx,.xlsx,.zip";
const MAX_MB = 25;

interface Props {
  resources: Resource[];
  onChange: (resources: Resource[]) => void;
}

export function ResourcesPanel({ resources, onChange }: Props) {
  function add() {
    onChange([...resources, { title: "", file_url: "", file_type: "", requires_entitlement: true }]);
  }

  function update(idx: number, patch: Partial<Resource>) {
    onChange(resources.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function remove(idx: number) {
    onChange(resources.filter((_, i) => i !== idx));
  }

  function handleFileChange(idx: number, file: File) {
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`File exceeds ${MAX_MB} MB limit.`);
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    // In production: upload to ImageKit then store URL.
    const url = URL.createObjectURL(file);
    update(idx, {
      file_url: url,
      file_type: ext,
      title: resources[idx].title || file.name.replace(/\.[^.]+$/, ""),
    });
  }

  return (
    <Panel title="Resources" description="Downloadable files for session participants.">
      <div className="space-y-3">
        {resources.map((r, idx) => (
          <div key={idx} className="rounded-lg border border-slate-800 p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-400">Title</label>
                <input
                  className={inputClass}
                  value={r.title}
                  onChange={(e) => update(idx, { title: e.target.value })}
                  placeholder="e.g. Session Slides"
                  maxLength={200}
                />
              </div>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="mt-6 text-slate-600 hover:text-red-400"
                aria-label="Remove resource"
              >
                ✕
              </button>
            </div>

            {r.file_url ? (
              <div className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2">
                <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="flex-1 truncate text-xs text-slate-300">{r.file_url}</span>
                <button
                  type="button"
                  onClick={() => update(idx, { file_url: "", file_type: "" })}
                  className="text-xs text-slate-500 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-slate-500 mb-1">File (max {MAX_MB} MB)</label>
                <input
                  type="file"
                  accept={ACCEPTED}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChange(idx, f); }}
                  className="block w-full text-xs text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:text-slate-200 hover:file:bg-slate-700"
                />
                <p className="mt-1 text-xs text-slate-600">PDF, DOCX, PPTX, XLSX, ZIP</p>
              </div>
            )}

            <Toggle
              label="Requires enrolment"
              description="Only registered participants can download this file."
              checked={r.requires_entitlement}
              onChange={(v) => update(idx, { requires_entitlement: v })}
            />
          </div>
        ))}

        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 text-sm text-brand hover:underline"
        >
          ＋ Add Resource
        </button>
      </div>
    </Panel>
  );
}
