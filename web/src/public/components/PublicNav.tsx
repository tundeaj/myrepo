import { useState, useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { usePublicT } from "../lib/publicI18n";

const NAV_LINKS = [
  { key: "nav.public.home", to: "/" },
  { key: "nav.public.live", to: "/live" },
  { key: "nav.public.courses", to: "/browse/courses" },
  { key: "nav.public.community", to: "/community" },
];

export function PublicNav({ platformName, logoUrl }: { platformName: string; logoUrl?: string }) {
  const { t } = usePublicT();
  const { user, status } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Transparent over the hero, solid once scrolled — the usual dark-theme
  // treatment, and it keeps the hero artwork unobstructed on arrival.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const signedIn = status === "signed-in" && user;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-200 ${
        scrolled || mobileOpen ? "bg-slate-950/95 backdrop-blur" : "bg-gradient-to-b from-black/70 to-transparent"
      }`}
    >
      <div className="flex items-center gap-4 px-4 py-3 sm:px-8">
        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={t("nav.public.menu")}
          aria-expanded={mobileOpen}
          className="text-slate-200 hover:text-white sm:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6" strokeLinecap="round">
            <path d={mobileOpen ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
          </svg>
        </button>

        {/* Logo */}
        <Link to="/" className="flex flex-shrink-0 items-center gap-2">
          {logoUrl ? (
            <img src={logoUrl} alt={platformName} className="h-7 w-auto" />
          ) : (
            <span className="text-lg font-black tracking-tight text-red-600">{platformName}</span>
          )}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-5 sm:flex">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.key}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                `text-sm transition-colors ${isActive ? "font-medium text-white" : "text-slate-300 hover:text-white"}`
              }
            >
              {t(link.key)}
            </NavLink>
          ))}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          <button aria-label={t("nav.public.search")} className="text-slate-300 hover:text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
            </svg>
          </button>

          {signedIn && (
            <button aria-label={t("nav.public.notifications")} className="text-slate-300 hover:text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 20a2 2 0 004 0" />
              </svg>
            </button>
          )}

          {signedIn ? (
            <Link to="/account" className="flex h-8 w-8 items-center justify-center rounded bg-slate-700 text-xs font-semibold text-slate-100 hover:bg-slate-600">
              {(user.full_name ?? user.email).slice(0, 1).toUpperCase()}
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" className="text-sm text-slate-300 hover:text-white">{t("nav.public.sign_in")}</Link>
              <Link to="/register" className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500">
                {t("nav.public.get_started")}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <nav className="border-t border-slate-800 px-4 pb-3 pt-2 sm:hidden">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.key}
              to={link.to}
              end={link.to === "/"}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `block py-2 text-sm ${isActive ? "font-medium text-white" : "text-slate-300"}`
              }
            >
              {t(link.key)}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
