import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useTranslation } from "../i18n/I18nProvider";
import { NAV_SECTIONS } from "./navConfig";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const { t } = useTranslation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const content = (
    <nav className="flex h-full flex-col overflow-y-auto scrollbar-thin px-2 py-4">
      <div className="mb-4 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">W</div>
        {!collapsed && <span className="truncate text-sm font-semibold tracking-wide text-slate-100">Webinarflix</span>}
        <button
          onClick={onToggleCollapsed}
          className="ml-auto hidden rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200 lg:block"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name="chevron" className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
      </div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.headingKey} className="mb-4">
          {!collapsed && (
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              {t(section.headingKey)}
            </div>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              if (item.children) {
                const open = openGroups[item.labelKey] ?? false;
                return (
                  <li key={item.labelKey}>
                    <button
                      onClick={() => setOpenGroups((g) => ({ ...g, [item.labelKey]: !open }))}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/70 hover:text-white"
                      title={collapsed ? t(item.labelKey) : undefined}
                    >
                      <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate text-left">{t(item.labelKey)}</span>
                          <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
                        </>
                      )}
                    </button>
                    {open && !collapsed && (
                      <ul className="ml-9 mt-0.5 space-y-0.5 border-l border-slate-800 pl-3">
                        {item.children.map((child) => (
                          <li key={child.path}>
                            <NavLink
                              to={child.path}
                              end
                              onClick={onCloseMobile}
                              className={({ isActive }) =>
                                `block truncate rounded-md px-2 py-1.5 text-sm ${
                                  isActive ? "text-brand font-medium" : "text-slate-400 hover:text-slate-100"
                                }`
                              }
                            >
                              {t(child.labelKey)}
                            </NavLink>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              }

              return (
                <li key={item.labelKey}>
                  <NavLink
                    to={item.path!}
                    end={item.path === "/admin"}
                    onClick={onCloseMobile}
                    title={collapsed ? t(item.labelKey) : undefined}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                        isActive ? "bg-brand/15 text-brand font-medium" : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                      }`
                    }
                  >
                    <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Desktop / tablet ≥1024px */}
      <aside
        className={`hidden shrink-0 border-r border-slate-800 bg-slate-950 transition-all duration-200 lg:block ${
          collapsed ? "w-[72px]" : "w-[260px]"
        }`}
      >
        {content}
      </aside>

      {/* Mobile <1024px — slide-over behind hamburger */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={onCloseMobile} />
          <aside className="absolute inset-y-0 left-0 w-[260px] border-r border-slate-800 bg-slate-950 shadow-xl">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
