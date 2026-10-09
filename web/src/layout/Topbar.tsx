import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useTranslation } from "../i18n/I18nProvider";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/api";

interface SearchResults {
  sessions: { id: number; title: string; slug: string; content_type: string; status: string }[];
  users: { id: number; full_name: string | null; email: string; role: string }[];
  speakers: { id: number; full_name: string; slug: string; organisation: string | null }[];
}

const EMPTY_RESULTS: SearchResults = { sessions: [], users: [], speakers: [] };

export function Topbar({ onOpenMobileMenu }: { onOpenMobileMenu: () => void }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ count: number }>("/notifications/unread-count")
      .then((res) => setUnread(res.count))
      .catch(() => setUnread(0));
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults(EMPTY_RESULTS);
      setSearchOpen(false);
      return;
    }
    const handle = setTimeout(() => {
      api<SearchResults>(`/dashboard/search?q=${encodeURIComponent(query)}`)
        .then((res) => {
          setResults(res);
          setSearchOpen(true);
        })
        .catch(() => setResults(EMPTY_RESULTS));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const totalResults = results.sessions.length + results.users.length + results.speakers.length;
  const initials = (user?.full_name || user?.email || "?").slice(0, 1).toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur">
      <button className="rounded-md p-2 text-slate-400 hover:bg-slate-800 lg:hidden" onClick={onOpenMobileMenu} aria-label="Open menu">
        <Icon name="menu" className="h-5 w-5" />
      </button>

      <div ref={searchBoxRef} className="relative flex-1 max-w-md">
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
          <Icon name="search" className="h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query && setSearchOpen(true)}
            placeholder={t("topbar.search_placeholder")}
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
          />
        </div>
        {searchOpen && (
          <div className="absolute z-30 mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 p-2 shadow-xl">
            {totalResults === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-slate-500">{t("empty.no_results")}</p>
            ) : (
              <div className="max-h-80 overflow-y-auto scrollbar-thin">
                {results.sessions.length > 0 && (
                  <ResultGroup label="Sessions">
                    {results.sessions.map((s) => (
                      <ResultRow key={`s${s.id}`} primary={s.title} secondary={s.content_type} onClick={() => navigate("/admin/sessions")} />
                    ))}
                  </ResultGroup>
                )}
                {results.speakers.length > 0 && (
                  <ResultGroup label="Speakers">
                    {results.speakers.map((s) => (
                      <ResultRow key={`sp${s.id}`} primary={s.full_name} secondary={s.organisation ?? undefined} onClick={() => navigate("/admin/speakers")} />
                    ))}
                  </ResultGroup>
                )}
                {results.users.length > 0 && (
                  <ResultGroup label="Users">
                    {results.users.map((u) => (
                      <ResultRow key={`u${u.id}`} primary={u.full_name ?? u.email} secondary={u.email} onClick={() => navigate("/admin/users")} />
                    ))}
                  </ResultGroup>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Link to="/" target="_blank" className="hidden items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 md:flex">
        <Icon name="eye" className="h-4 w-4" />
        {t("topbar.preview_site")}
      </Link>

      <button className="relative rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200" aria-label="Notifications">
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      <div className="relative">
        <button onClick={() => setAvatarOpen((o) => !o)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-slate-200 hover:ring-2 hover:ring-slate-700">
          {initials}
        </button>
        {avatarOpen && (
          <div className="absolute right-0 z-30 mt-2 w-48 rounded-lg border border-slate-800 bg-slate-900 py-1 shadow-xl">
            <div className="border-b border-slate-800 px-3 py-2">
              <p className="truncate text-sm font-medium text-slate-100">{user?.full_name ?? "Admin"}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
            <button className="block w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800">{t("topbar.profile")}</button>
            <Link to="/admin/settings" className="block px-3 py-2 text-sm text-slate-300 hover:bg-slate-800" onClick={() => setAvatarOpen(false)}>
              {t("topbar.settings")}
            </Link>
            <button onClick={logout} className="block w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-slate-800">
              {t("topbar.logout")}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-600">{label}</div>
      {children}
    </div>
  );
}

function ResultRow({ primary, secondary, onClick }: { primary: string; secondary?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full flex-col rounded-md px-2 py-1.5 text-left hover:bg-slate-800">
      <span className="truncate text-sm text-slate-100">{primary}</span>
      {secondary && <span className="truncate text-xs text-slate-500">{secondary}</span>}
    </button>
  );
}
