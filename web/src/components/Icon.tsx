// A small hand-picked set of stroke icons (24x24, currentColor) — enough to give every
// sidebar section a distinct mark without pulling in an icon library dependency.
const PATHS: Record<string, string> = {
  grid: "M4 5h6v6H4V5zm10 0h6v6h-6V5zM4 15h6v6H4v-6zm10 0h6v6h-6v-6z",
  video: "M4 6h11v12H4V6zm11 4l5-3v10l-5-3",
  play: "M6 4l14 8-14 8V4z",
  book: "M5 4h9a3 3 0 013 3v13H8a3 3 0 00-3 3V4z M17 20a3 3 0 00-3-3H5",
  image: "M4 5h16v14H4V5zm3 10l4-4 3 3 3-4 3 5H7z M8 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  mic: "M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3z M6 11a6 6 0 0012 0 M12 17v4 M9 21h6",
  users: "M9 11a3 3 0 100-6 3 3 0 000 6z M3 21a6 6 0 0112 0 M17 11a3 3 0 100-6 M15 21a6 6 0 019-5.7 M17 11a3 3 0 013 3",
  ticket: "M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8z",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4",
  message: "M4 5h16v11H8l-4 4V5z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
  credit: "M3 6h18v12H3V6zm0 5h18",
  tag: "M4 12l8-8h6v6l-8 8-6-6z M14 6.5a.5.5 0 100 1 .5.5 0 000-1z",
  wallet: "M3 7h15a3 3 0 013 3v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm14 6a1 1 0 100-2 1 1 0 000 2z M3 7l3-3h9",
  megaphone: "M3 10v4h4l7 4V6l-7 4H3z M17 9a3 3 0 010 6",
  briefcase: "M4 8h16v11H4V8zm4 0V6a2 2 0 012-2h4a2 2 0 012 2v2",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  layout: "M4 4h16v4H4V4zm0 6h7v10H4V10zm9 0h7v10h-7V10z",
  file: "M6 3h9l5 5v13H6V3zm9 0v5h5",
  megaphoneOutline: "M3 11v2a2 2 0 002 2h1l4 4v-4h6a2 2 0 002-2v-2 M3 11l6-3h5v10H9l-6-3v-4z",
  question: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 17v.01M9.5 9a2.5 2.5 0 115 0c0 1.5-2.5 2-2.5 3.5",
  mail: "M4 5h16v14H4V5zm0 0l8 7 8-7",
  folder: "M3 6a2 2 0 012-2h5l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h1M19 12h1M12 4v1M12 19v1M6 6l.7.7M17.3 17.3l.7.7M6 18l.7-.7M17.3 6.7l.7-.7",
  toggle: "M7 8h10a4 4 0 010 8H7a4 4 0 010-8zm0 4a0 0 0 000 0",
  clipboard: "M9 4h6v3H9V4zM6 6h12v15H6V6z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 15a3 3 0 100-6 3 3 0 000 6z",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3",
  bell: "M6 8a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z M10 20a2 2 0 004 0",
  chevron: "M9 6l6 6-6 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  "arrow-left": "M19 12H5M12 5l-7 7 7 7",
  flame: "M12 2c1.5 3-2 5-2 8a2 2 0 004 0c0-1-.5-2-1-3 2 1 4 3 4 6a5 5 0 01-10 0c0-5 3-7 5-11z",
  arrowUp: "M12 19V5 M5 12l7-7 7 7",
  arrowDown: "M12 5v14 M19 12l-7 7-7-7",
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  const d = PATHS[name] ?? PATHS.grid;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}
