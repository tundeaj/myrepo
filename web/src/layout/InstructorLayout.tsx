import { useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { Icon } from "../components/Icon";

// ─── Instructor portal shell — a slimmer sidebar than the admin console.
// Access requires role instructor / admin / super_admin (also enforced server-side).

const NAV_ITEMS = [
  { label: "Dashboard", icon: "grid", path: "/instructor", end: true },
  { label: "My Content", icon: "video", path: "/instructor/content" },
  { label: "Media Library", icon: "upload", path: "/instructor/media" },
  { label: "Learners", icon: "users", path: "/instructor/learners" },
  { label: "Earnings", icon: "wallet", path: "/instructor/earnings" },
  { label: "Payout Details", icon: "credit", path: "/instructor/payout-details" },
  { label: "Schedule", icon: "bell", path: "/instructor/schedule" },
];

const INSTRUCTOR_ROLES = new Set(["instructor", "admin", "super_admin"]);

export function InstructorLayout() {
  const { user, status, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
      </div>
    );
  }
  if (status === "signed-out") return <Navigate to="/login" replace />;
  if (user && !INSTRUCTOR_ROLES.has(user.role)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center">
        <p className="text-sm font-semibold text-slate-100">This area is for instructors.</p>
        <p className="max-w-sm text-sm text-slate-400">
          Want to teach on Webinarflix? Apply on our instructor page and we'll review your application.
        </p>
        <button onClick={() => navigate("/teach")} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          Apply to teach
        </button>
      </div>
    );
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">W</span>
        <div>
          <p className="text-sm font-semibold text-slate-100">Webinarflix</p>
          <p className="text-[11px] text-slate-500">Instructor Portal</p>
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 px-2 py-2">
        {NAV_ITEMS.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-brand/15 text-brand font-medium" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`
              }
            >
              <Icon name={item.icon} className="h-4 w-4" />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-2 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">
            {(user?.full_name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-200">{user?.full_name ?? user?.email}</p>
            <button onClick={() => { logout(); navigate("/login"); }} className="text-[11px] text-slate-500 hover:text-red-400">
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-shrink-0 border-r border-slate-800 bg-slate-900/40 lg:block">
        {sidebar}
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-800 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile topbar */}
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3 lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="text-slate-400 hover:text-slate-200">
            <Icon name="menu" className="h-5 w-5" />
          </button>
          <p className="text-sm font-semibold text-slate-100">Instructor Portal</p>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
