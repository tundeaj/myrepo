import { useState, useEffect, useCallback } from "react";
import { api } from "../../lib/api";
import { useToast } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { Icon } from "../../components/Icon";

type Role = "viewer" | "instructor" | "admin" | "super_admin";

interface UserRow {
  id: number;
  email: string;
  full_name: string | null;
  role: Role;
  country: string;
  seat_status: string;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
}

interface UserDetail {
  user: UserRow & { timezone: string; industry: string | null; job_role: string | null; company_name: string | null; headline: string | null; bio: string | null };
  activity: {
    paid_order_count: number;
    entitlement_count: number;
    playback_session_count: number;
    active_subscription: { id: number; status: string; current_period_end: string | null } | null;
  };
}

const ROLES: Role[] = ["viewer", "instructor", "admin", "super_admin"];

const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  instructor: "Instructor",
  admin: "Admin",
  super_admin: "Super Admin",
};

function DetailSlideOver({ userId, onClose, onChanged }: { userId: number; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<UserDetail>(`/users/${userId}`)
      .then(setDetail)
      .catch((e: any) => setError(e.message ?? "Failed to load user."));
  }, [userId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-slate-800 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Account</h2>
          <button onClick={onClose} className="text-xl leading-none text-slate-500 hover:text-slate-300">×</button>
        </div>

        {error && <ErrorState message={error} onRetry={() => {}} />}
        {!detail && !error && <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}

        {detail && (
          <div className="space-y-5 text-sm">
            <div>
              <div className="text-base font-medium text-slate-100">{detail.user.full_name || "(no name)"}</div>
              <div className="text-slate-500">{detail.user.email}</div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-slate-500">Role</div>
                <div className="mt-0.5 text-slate-200">{ROLE_LABEL[detail.user.role]}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-slate-500">Status</div>
                <div className="mt-0.5 text-slate-200">{detail.user.is_active ? "Active" : "Deactivated"}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-slate-500">Country</div>
                <div className="mt-0.5 text-slate-200">{detail.user.country}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-slate-500">Email verified</div>
                <div className="mt-0.5 text-slate-200">{detail.user.email_verified ? "Yes" : "No"}</div>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Activity</h3>
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-100">{detail.activity.paid_order_count}</div>
                  <div className="mt-1 text-slate-500">Paid orders</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-100">{detail.activity.entitlement_count}</div>
                  <div className="mt-1 text-slate-500">Entitlements</div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-3">
                  <div className="text-lg font-semibold text-slate-100">{detail.activity.playback_session_count}</div>
                  <div className="mt-1 text-slate-500">Playback sessions</div>
                </div>
              </div>
              {detail.activity.active_subscription && (
                <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  Active subscription — status: {detail.activity.active_subscription.status}
                  {detail.activity.active_subscription.current_period_end ? `, renews ${new Date(detail.activity.active_subscription.current_period_end).toLocaleDateString()}` : ""}
                </div>
              )}
            </div>

            {(detail.user.company_name || detail.user.job_role || detail.user.headline) && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Profile</h3>
                <div className="space-y-1 text-slate-400">
                  {detail.user.headline && <div>{detail.user.headline}</div>}
                  {(detail.user.job_role || detail.user.company_name) && (
                    <div>{[detail.user.job_role, detail.user.company_name].filter(Boolean).join(" @ ")}</div>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500">Created {new Date(detail.user.created_at).toLocaleDateString()}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function Users() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correlationId, setCorrelationId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (roleFilter) params.set("role", roleFilter);
    if (activeFilter) params.set("is_active", activeFilter);
    api<{ users: UserRow[] }>(`/users?${params.toString()}`)
      .then((res) => { setUsers(res.users); setLoading(false); })
      .catch((err) => {
        setError(err.message ?? "Failed to load users.");
        setCorrelationId(err.correlationId);
        setLoading(false);
      });
  }, [search, roleFilter, activeFilter]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function changeRole(u: UserRow, role: Role) {
    if (role === u.role) return;
    setSavingId(u.id);
    try {
      const res = await api<{ user: UserRow }>(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      setUsers((prev) => prev?.map((x) => (x.id === u.id ? res.user : x)) ?? null);
      toast(`Role updated to ${ROLE_LABEL[role]}.`);
    } catch (e: any) {
      toast(e.message ?? "Failed to update role.", "error");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(u: UserRow) {
    const next = !u.is_active;
    if (!next && !confirm(`Deactivate ${u.email}? They won't be able to sign in.`)) return;
    setSavingId(u.id);
    try {
      const res = await api<{ user: UserRow }>(`/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ is_active: next }) });
      setUsers((prev) => prev?.map((x) => (x.id === u.id ? res.user : x)) ?? null);
      toast(next ? "Account reactivated." : "Account deactivated.");
    } catch (e: any) {
      toast(e.message ?? "Failed to update status.", "error");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {viewingId !== null && <DetailSlideOver userId={viewingId} onClose={() => setViewingId(null)} onChanged={load} />}

      <div>
        <h1 className="text-lg font-semibold text-slate-100">Users</h1>
        <p className="mt-1 text-sm text-slate-500">Every viewer, instructor and admin account on the platform.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-brand"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | "")} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-brand">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as "" | "true" | "false")} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none focus:border-brand">
          <option value="">Active &amp; inactive</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : error ? (
        <ErrorState message={error} correlationId={correlationId} onRetry={load} />
      ) : !users?.length ? (
        <EmptyState icon={<Icon name="users" className="h-6 w-6" />} heading="No accounts match" explanation="Try clearing the search or filters." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Country</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {users.map((u) => (
                  <tr key={u.id} className="group hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <button onClick={() => setViewingId(u.id)} className="font-medium text-slate-100 hover:text-brand">
                        {u.full_name || "(no name)"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={savingId === u.id}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-brand disabled:opacity-50"
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.country}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${u.is_active ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-800 text-slate-500"}`}>
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setViewingId(u.id)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-200">View</button>
                        <button
                          onClick={() => toggleActive(u)}
                          disabled={savingId === u.id}
                          className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${u.is_active ? "text-slate-400 hover:bg-red-900/30 hover:text-red-400" : "text-slate-400 hover:bg-emerald-900/30 hover:text-emerald-400"}`}
                        >
                          {savingId === u.id ? "…" : u.is_active ? "Deactivate" : "Reactivate"}
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
