// Image URL construction for public cards.
//
// Two things are happening here and they are deliberately split:
//
//   1. ImageKit resizes the source to roughly the box the card actually renders
//      at (with dpr awareness, q-auto and f-auto). This is the part that meets
//      the "served at rendered card size" performance gate — a 2400px master
//      never reaches a 200px poster.
//
//   2. The focal point is applied as CSS object-position, not as an ImageKit
//      crop. ImageKit's crop-toward-a-point modes need pixel offsets against the
//      source dimensions, which the card payload doesn't carry. Asking ImageKit
//      for c-at_max (resize, preserve aspect) and letting object-cover +
//      object-position do the framing gives precise focal cropping at any card
//      aspect ratio, and matches how the admin's crop previews already work.
//
// A raw master URL is never rendered: when ImageKit isn't configured the source
// still goes through buildImageUrl, which returns it unchanged but keeps every
// caller on one code path.

export interface ImageSource {
  master_image_url: string | null;
  focal_x: number;
  focal_y: number;
}

let imagekitEndpoint = "";

/** Seeded once from the Stage 1 payload, so no extra request is needed. */
export function configureImages(endpoint: string) {
  imagekitEndpoint = (endpoint || "").replace(/\/+$/, "");
}

/** Device pixel ratio, clamped — beyond 2x the bytes cost more than the sharpness gains. */
function dpr(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
}

export function buildImageUrl(url: string | null, renderedWidth: number): string | null {
  if (!url) return null;
  if (!imagekitEndpoint) return url;

  // Already an ImageKit URL for this endpoint: replace any existing transform.
  const path = url.startsWith(imagekitEndpoint)
    ? url.slice(imagekitEndpoint.length).replace(/^\/tr:[^/]+/, "")
    : url.startsWith("http")
      ? null // foreign absolute URL — leave it alone rather than mangle it
      : url;

  if (path === null) return url;

  const width = Math.round(renderedWidth * dpr());
  const transform = `tr:w-${width},c-at_max,q-auto,f-auto`;
  return `${imagekitEndpoint}/${transform}/${path.replace(/^\/+/, "")}`;
}

/** CSS object-position string from a card's focal point. */
export function focalPosition(src: Pick<ImageSource, "focal_x" | "focal_y">): string {
  return `${src.focal_x}% ${src.focal_y}%`;
}

/** Rendered widths per card variant — drives the ImageKit width above. */
export const CARD_WIDTHS: Record<string, number> = {
  poster: 200,
  landscape: 320,
  numbered: 200,
  tile: 280,
  speaker: 160,
  hero: 1280,
};
