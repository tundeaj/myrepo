import { useRef, useState, useEffect } from "react";
import { Card, CardSkeleton } from "./Card";
import { usePublicT } from "../lib/publicI18n";
import type { HomepageRow, ContentCard, SpeakerCard, CategoryCard } from "../lib/types";

// A horizontal-scroll carousel. Arrows on desktop, native scroll on mobile —
// no arrows there, because a thumb already does the job and the buttons would
// just cover cards.

function useCanScroll(ref: React.RefObject<HTMLDivElement>, itemCount: number) {
  const [state, setState] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      setState({
        left: el.scrollLeft > 8,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 8,
      });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ref, itemCount]);

  return state;
}

function ArrowButton({ dir, onClick, label }: { dir: "left" | "right"; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`absolute top-0 bottom-0 z-10 hidden w-12 items-center justify-center bg-gradient-to-${dir === "left" ? "r" : "l"} from-black/80 to-transparent text-white/80 transition-opacity hover:text-white sm:flex ${
        dir === "left" ? "left-0" : "right-0"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-6 w-6" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
      </svg>
    </button>
  );
}

interface Props {
  row: HomepageRow;
  /** Personal rows show skeletons until their Stage 2 payload lands. */
  awaitingPersonal?: boolean;
  /** Above-fold rows decode their first images eagerly. */
  eager?: boolean;
}

export function Row({ row, awaitingPersonal = false, eager = false }: Props) {
  const { t } = usePublicT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { left, right } = useCanScroll(scrollerRef, row.items.length);

  // Zero-item row with hide_when_empty renders NOTHING — no header, no
  // placeholder. A personal row still waiting on Stage 2 is not "empty" yet,
  // so it keeps its reserved slot.
  if (!row.items.length && !awaitingPersonal && row.hide_when_empty) return null;
  if (!row.items.length && !awaitingPersonal) return null;

  function scrollBy(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  }

  const skeletonCount = 6;

  return (
    <section className="relative py-3">
      <h2 className="mb-2 px-4 text-sm font-semibold text-slate-200 sm:px-8 sm:text-base">
        {row.label}
      </h2>

      <div className="relative">
        {left && <ArrowButton dir="left" onClick={() => scrollBy(-1)} label={t("home.scroll_left")} />}
        {right && <ArrowButton dir="right" onClick={() => scrollBy(1)} label={t("home.scroll_right")} />}

        <div
          ref={scrollerRef}
          className="flex gap-2 overflow-x-auto scroll-smooth px-4 pb-2 sm:gap-3 sm:px-8"
          style={{ scrollbarWidth: "none" }}
        >
          {awaitingPersonal && !row.items.length
            ? Array.from({ length: skeletonCount }).map((_, i) => <CardSkeleton key={i} variant={row.card_style} />)
            : row.items.map((item, i) => (
                <Card
                  key={`${row.row_key}-${(item as ContentCard | SpeakerCard | CategoryCard).id}`}
                  item={item}
                  kind={row.kind}
                  variant={row.card_style}
                  rank={row.card_style === "numbered" ? i + 1 : undefined}
                  eager={eager && i < 6}
                />
              ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Defers mounting a row until it is close to the viewport. Rows above the fold
 * render immediately; the rest wait for IntersectionObserver, which is what
 * keeps a long homepage from decoding every image at once.
 */
export function LazyRow({ row, awaitingPersonal, eager, immediate }: Props & { immediate: boolean }) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    if (visible) return;
    const el = holderRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  if (visible) return <Row row={row} awaitingPersonal={awaitingPersonal} eager={eager} />;

  // Reserve roughly a row's height so the scrollbar doesn't jump as rows mount.
  return <div ref={holderRef} className="h-[220px]" aria-hidden />;
}
