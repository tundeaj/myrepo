// Shapes returned by the public homepage endpoints. These mirror the trimmed
// allowlist assembled in server/src/lib/homepageCache.ts — if a field isn't
// here, it isn't in the payload, by design.

export interface ContentCard {
  id: number;
  slug: string;
  title: string;
  master_image_url: string | null;
  focal_x: number;
  focal_y: number;
  status: string;
  scheduled_start_at: string | null;
  timezone: string;
  scheduled_duration_minutes: number | null;
  access_level: string;
  price_ngn: number | null;
  avg_rating: number;
  speaker_names: string[];
  category_names: string[];
  has_audio_only: boolean;
  duration_seconds: number | null;
  /** Short hover-preview clip. Only ever populated for unprotected trailer
   *  assets; null means the card shows its info overlay instead. */
  trailer_url: string | null;
  /** Present only on personal rows, where the viewer has partial progress. */
  progress_pct?: number;
}

export interface SpeakerCard {
  id: number;
  slug: string;
  full_name: string;
  title: string | null;
  organisation: string | null;
  master_image_url: string | null;
  focal_x: number;
  focal_y: number;
}

export interface CategoryCard {
  id: number;
  slug: string | null;
  name: string;
  image_url: string | null;
}

export type CardVariant = "poster" | "landscape" | "numbered" | "tile" | "speaker";

export interface HomepageRow {
  row_key: string | null;
  label: string | null;
  label_fr: string | null;
  row_type: string;
  card_style: CardVariant;
  card_limit: number;
  display_order: number;
  hide_when_empty: boolean;
  personal: boolean;
  kind: "content" | "speaker" | "category";
  items: (ContentCard | SpeakerCard | CategoryCard)[];
}

export interface HomepagePayload {
  surface: string;
  platform: string;
  audience: string;
  hero: ContentCard[];
  rows: HomepageRow[];
  settings: Record<string, string>;
  strings: Record<string, { en: string | null; fr: string | null }>;
  generated_at: string;
}

export interface PersonalRowsPayload {
  rows: { row_key: string | null; row_type: string; items: ContentCard[] }[];
}

export interface LiveRowsPayload {
  rows: { row_key: string | null; row_type: string; items: ContentCard[] }[];
  polled_at: string;
}

// ─── Shared formatting ────────────────────────────────────────────────────────

export function formatCountdown(target: string | null, now: number = Date.now()): string | null {
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatRuntime(seconds: number | null, fallbackMinutes: number | null): string | null {
  const totalMinutes = seconds != null ? Math.round(seconds / 60) : fallbackMinutes;
  if (!totalMinutes) return null;
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatPrice(price: number | null): string | null {
  if (price == null) return null;
  if (price === 0) return null;
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(price);
}

/** Paid tiers show a lock; public and registered content does not. */
export function isLocked(accessLevel: string): boolean {
  return accessLevel === "subscriber" || accessLevel === "purchase" || accessLevel === "cohort";
}
