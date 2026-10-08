import { useState, useRef } from "react";
import { api, getToken } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { Icon } from "../../components/Icon";
import { inputClass } from "../../components/session/Panel";

type Entity = "speakers" | "categories";

interface ImportResult {
  created: { row: number; full_name?: string; name?: string }[];
  failed: { row: number; error: string }[];
}

const ENTITY_LABEL: Record<Entity, string> = { speakers: "Speakers", categories: "Categories" };
const ENTITY_COLUMNS: Record<Entity, string> = {
  speakers: "full_name, email, phone, title, organisation, bio",
  categories: "name, description, display_order, show_as_tile, is_active",
};

function EntitySection({ entity }: { entity: Entity }) {
  const { toast } = useToast();
  const [csv, setCsv] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function exportCsv() {
    setExporting(true);
    const token = getToken();
    fetch(`/api/bulk-import/${entity}/export`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${entity}.csv`; a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast("Export failed.", "error"))
      .finally(() => setExporting(false));
  }

  function onFileChosen(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function runImport() {
    if (!csv.trim()) { toast("Paste or choose a CSV file first.", "error"); return; }
    setImporting(true);
    setResult(null);
    try {
      const res = await api<ImportResult>(`/bulk-import/${entity}/import`, { method: "POST", body: JSON.stringify({ csv }) });
      setResult(res);
      toast(`${res.created.length} created${res.failed.length ? `, ${res.failed.length} failed` : ""}.`, res.failed.length && !res.created.length ? "error" : res.failed.length ? "info" : "success");
    } catch (e: any) {
      toast(e.message ?? "Import failed.", "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{ENTITY_LABEL[entity]}</h2>
          <p className="mt-1 font-mono text-xs text-slate-600">{ENTITY_COLUMNS[entity]}</p>
        </div>
        <button onClick={exportCsv} disabled={exporting} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
          <Icon name="upload" className="h-3.5 w-3.5" />
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChosen(f); }}
            className="text-xs text-slate-500"
          />
        </div>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          className={`${inputClass} min-h-[120px] font-mono text-xs`}
          placeholder={`${ENTITY_COLUMNS[entity]}\n...`}
        />
        <button onClick={runImport} disabled={importing} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
          {importing ? "Importing…" : "Import CSV"}
        </button>

        {result && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
            <p className="text-emerald-300">{result.created.length} row{result.created.length === 1 ? "" : "s"} created.</p>
            {result.failed.length > 0 && (
              <div className="mt-2">
                <p className="text-red-400">{result.failed.length} row{result.failed.length === 1 ? "" : "s"} failed:</p>
                <ul className="mt-1 space-y-0.5 text-slate-500">
                  {result.failed.map((f) => (
                    <li key={f.row}>Row {f.row}: {f.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function BulkImport() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Bulk Import / Export</h1>
        <p className="mt-1 text-sm text-slate-500">
          CSV export and import for Speakers and Categories — the two simplest flat entities. A bad row never blocks the good ones in the same file; each row's own result is reported below.
        </p>
      </div>

      <EntitySection entity="speakers" />
      <EntitySection entity="categories" />
    </div>
  );
}
