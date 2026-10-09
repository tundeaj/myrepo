import { useEffect, useState } from "react";

// Decides whether a hover teaser is affordable for this visitor right now.
//
// A teaser is a genuine improvement on a fast connection and a genuine cost on a
// slow one, so the answer is measured rather than assumed. Everything here fails
// safe: when a signal is unavailable we allow the teaser only if nothing else
// argues against it, and any playback failure still drops back to the info
// overlay at the component level.

interface NetworkInformation {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
  downlink?: number;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
}

function connection(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

/** Minimum downlink, in Mbps, worth streaming a preview clip over. */
const MIN_DOWNLINK_MBPS = 1.5;

function evaluate(): boolean {
  if (typeof window === "undefined") return false;

  // Hover is a desktop interaction. A coarse pointer has no hover state to
  // speak of, and mobile is exactly where the bandwidth matters most.
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return false;

  // Someone who asked for less motion did not ask for autoplaying video.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

  const conn = connection();
  if (!conn) return true; // no signal to the contrary — allow, and let playback errors decide

  // Data Saver is an explicit request. Honour it without argument.
  if (conn.saveData) return false;

  if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g" || conn.effectiveType === "3g") return false;
  if (typeof conn.downlink === "number" && conn.downlink > 0 && conn.downlink < MIN_DOWNLINK_MBPS) return false;

  return true;
}

/**
 * True when a hover teaser should be attempted. Re-evaluates when the network
 * changes, so a visitor who walks out of Wi-Fi stops paying for previews without
 * needing to reload.
 */
export function useTeaserBudget(): boolean {
  const [allowed, setAllowed] = useState(() => evaluate());

  useEffect(() => {
    const update = () => setAllowed(evaluate());

    const conn = connection();
    conn?.addEventListener?.("change", update);

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    motion.addEventListener("change", update);
    pointer.addEventListener("change", update);

    return () => {
      conn?.removeEventListener?.("change", update);
      motion.removeEventListener("change", update);
      pointer.removeEventListener("change", update);
    };
  }, []);

  return allowed;
}

/** How long a pointer must rest on a card before the teaser loads. Long enough
 *  that sweeping across a row costs nothing. */
export const TEASER_HOVER_DELAY_MS = 700;
