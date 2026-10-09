import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { StatusBadge } from "../../components/StatusBadge";
import type { ContentStatus } from "../../components/StatusBadge";
import { Icon } from "../../components/Icon";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { formatCount } from "../../lib/format";

interface CourseRow {
  id: number;
  title: string;
  slug: string;
  status: ContentStatus;
  access_level: string;
  is_featured: boolean;
  is_active: boolean;
  master_image_url: string | null;
  module_count: number;
  lesson_count: number;
  created_at: string;
}

interface ListResponse {
  courses: CourseRow[];
  meta: { total: number; page: number; per_page: number; pages: number };
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "pending_review", label: "Pending review" },
  { value: "registration_open", label: "Published" },
  { value: "archived", label: "Archived" },
];

export function AllCourses() {
  const navigate = useNavigate();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ page: String(page), per_page: "25" });
    if (debouncedQ) params.set("q", debouncedQ);
    if (status) params.set("status", status);

    api<ListResponse>(`/courses?${params}`)
      .then((res) => {
        if (!cancelled) { setData(res); setLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? "Failed to load courses.");
          setCorrelationId(err.correlationId);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [page, debouncedQ, status]);

  async function handleDelete(course: CourseRow) {
    if (!confirm(`Delete "${course.title}"? This removes all modules and lessons and cannot be undone.`)) return;
    setDeletingId(course.id);
    try {
      await api(`/courses/${course.id}`, { method: "DELETE" });
      setData((prev) =>
        prev
          ? {
              ...prev,
              courses: prev.courses.filter((c) => c.id !== course.id),
              meta: { ...prev.meta, total: prev.meta.total - 1 },
            }
          : prev,
      );
    } catch (err: any) {
      alert(err.message ?? "Failed to delete course.");
    } finally {
      setDeletingId(null);
    }
  }

  const meta = data?.meta;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Courses</h1>
          <p className="text-sm text-slate-500">
            {loading ? "Loading…" : `${formatCount(meta?.total ?? 0)} course${meta?.total === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          onClick={() => navigate("/admin/courses/new")}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
        >
          <Icon name="video" className="h-4 w-4" />
          Add Course
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search courses…"
            className="w-full rounded-lg border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
          />
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={() => setPage((p) => p)} />
      ) : !data?.courses.length ? (
        <EmptyState
          icon={<Icon name="video" className="h-6 w-6" />}
          heading="No courses yet"
          explanation={
            debouncedQ || status
              ? "Try changing your filters."
              : "Create your first course to start building structured learning content."
          }
          actionLabel={!debouncedQ && !status ? "Add Course" : undefined}
          onAction={!debouncedQ && !status ? () => navigate("/admin/courses/new") : undefined}
          variant={debouncedQ || status ? "filtered" : "create"}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800">
              <tr className="text-left text-xs text-slate-500">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Modules / Lessons</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/20">
              {data.courses.map((c) => (
                <tr key={c.id} className="group hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {c.master_image_url ? (
                        <img
                          src={c.master_image_url}
                          alt=""
                          className="h-10 w-16 flex-shrink-0 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-16 flex-shrink-0 items-center justify-center rounded bg-slate-800 text-slate-600">
                          <Icon name="video" className="h-4 w-4" />
                        </div>
                      )}
                      <div>
                        <button
                          onClick={() => navigate(`/admin/courses/${c.id}/edit`)}
                          className="font-medium text-slate-100 hover:text-brand text-left"
                        >
                          {c.title}
                        </button>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-slate-600">/courses/{c.slug}</p>
                          {c.is_featured && (
                            <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-xs text-brand">Featured</span>
                          )}
                          {!c.is_active && (
                            <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-xs text-slate-500">Inactive</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-400 text-xs">
                    <span className="font-medium text-slate-300">{c.module_count}</span> modules
                    <span className="mx-1 text-slate-600">·</span>
                    <span className="font-medium text-slate-300">{c.lesson_count}</span> lessons
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 capitalize">
                    {c.access_level.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => navigate(`/admin/courses/${c.id}/edit`)}
                        className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.id}
                        className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-900/30 hover:text-red-400 disabled:opacity-50"
                      >
                        {deletingId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Page {meta.page} of {meta.pages} · {formatCount(meta.total)} courses
          </p>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              disabled={page === meta.pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
