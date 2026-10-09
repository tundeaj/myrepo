import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";
import { Toggle, inputClass } from "../../components/session/Panel";

interface Category {
  id: number;
  name: string | null;
  name_fr: string | null;
  slug: string | null;
  description: string | null;
  description_fr: string | null;
  image_url: string | null;
  show_as_tile: boolean;
  display_order: number;
  is_active: boolean;
}

interface FormState {
  name: string;
  name_fr: string;
  description: string;
  image_url: string;
  show_as_tile: boolean;
  display_order: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = { name: "", name_fr: "", description: "", image_url: "", show_as_tile: false, display_order: "0", is_active: true };

function categoryToForm(c: Category): FormState {
  return {
    name: c.name ?? "",
    name_fr: c.name_fr ?? "",
    description: c.description ?? "",
    image_url: c.image_url ?? "",
    show_as_tile: c.show_as_tile,
    display_order: String(c.display_order),
    is_active: c.is_active,
  };
}

function CategorySlideOver({ category, onClose, onSaved }: { category: Category | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(category ? categoryToForm(category) : EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    const name = form.name.trim();
    if (!name) { setErr("A name is required."); return; }

    setBusy(true);
    setErr(null);
    const payload = {
      name,
      name_fr: form.name_fr.trim() || null,
      description: form.description.trim() || null,
      image_url: form.image_url.trim() || null,
      show_as_tile: form.show_as_tile,
      display_order: Number(form.display_order) || 0,
      is_active: form.is_active,
    };
    try {
      if (category) {
        await api(`/categories/${category.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await api("/categories", { method: "POST", body: JSON.stringify(payload) });
      }
      toast(`Category ${category ? "updated" : "created"}.`);
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Failed to save category.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">{category ? "Edit Category" : "Add Category"}</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name</label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} maxLength={100} placeholder="e.g. Leadership" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Name (French)</label>
              <input type="text" value={form.name_fr} onChange={(e) => set("name_fr", e.target.value)} className={inputClass} maxLength={100} placeholder="Optional" />
            </div>
          </div>

          {category && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
              Slug: <span className="font-mono text-slate-400">{category.slug}</span> — set once at creation, never changes on rename, so existing /browse links keep working.
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-slate-400">Description</label>
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} className={`${inputClass} min-h-[80px]`} maxLength={300} placeholder="Optional, shown on the category's browse page" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Image URL</label>
            <input type="text" value={form.image_url} onChange={(e) => set("image_url", e.target.value)} className={inputClass} maxLength={500} placeholder="Optional" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Display order</label>
            <input type="number" value={form.display_order} onChange={(e) => set("display_order", e.target.value)} className={inputClass} placeholder="Lower shows first" />
          </div>

          <Toggle label="Show as homepage tile" description="Featured as a browsable tile on the homepage, not just under /browse." checked={form.show_as_tile} onChange={(v) => set("show_as_tile", v)} />
          <Toggle label="Active" description="Inactive categories are hidden from the classification panel and the public site, but keep their content tags." checked={form.is_active} onChange={(v) => set("is_active", v)} />

          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-slate-200">Cancel</button>
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Saving…" : category ? "Save changes" : "Create category"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Categories() {
  const { toast } = useToast();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api<{ categories: Category[] }>("/categories?all=1")
      .then((res) => { setCategories(res.categories); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load categories.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(category: Category) {
    if (!confirm(`Delete "${category.name}"?`)) return;
    setDeletingId(category.id);
    try {
      await api(`/categories/${category.id}`, { method: "DELETE" });
      setCategories((prev) => prev?.filter((c) => c.id !== category.id) ?? null);
      toast("Category deleted.");
    } catch (e: any) {
      if (e.status === 409) {
        if (confirm(`${e.message}\n\nDeactivate instead?`)) {
          try {
            await api(`/categories/${category.id}`, {
              method: "PUT",
              body: JSON.stringify({ ...category, is_active: false }),
            });
            load();
            toast("Category deactivated.");
          } catch (e2: any) {
            toast(e2.message ?? "Failed to deactivate.", "error");
          }
        }
      } else {
        toast(e.message ?? "Failed to delete category.", "error");
      }
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (error) return <ErrorState message={error} correlationId={correlationId} onRetry={load} />;

  return (
    <div className="space-y-5">
      {editing && (
        <CategorySlideOver
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Categories</h1>
          <p className="mt-1 text-sm text-slate-500">How content is grouped under /browse and tagged in the session/course editor.</p>
        </div>
        <button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          <Icon name="folder" className="h-4 w-4" />
          Add Category
        </button>
      </div>

      {!categories?.length ? (
        <EmptyState
          icon={<Icon name="folder" className="h-6 w-6" />}
          heading="No categories yet"
          explanation="Categories group content under /browse and in the classification panel."
          actionLabel="Add Category"
          onAction={() => setEditing("new")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Order</th>
                  <th className="px-4 py-3 font-medium">Homepage tile</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {categories.map((c) => (
                  <tr key={c.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-100">{c.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.slug}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-400">{c.display_order}</td>
                    <td className="px-4 py-3 text-slate-500">{c.show_as_tile ? "Yes" : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${c.is_active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-500"}`}>
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEditing(c)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">Edit</button>
                        <button onClick={() => handleDelete(c)} disabled={deletingId === c.id} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50">
                          {deletingId === c.id ? "…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
