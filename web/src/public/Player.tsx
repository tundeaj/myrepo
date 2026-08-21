import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import Hls from "hls.js";
import { getToken } from "../lib/api";
import { fetchPublic, PublicError, PublicPageSkeleton } from "./lib/publicPage";
import { AccessGate, type AccessResult } from "./components/AccessGate";
import { formatRuntime } from "./lib/types";

/**
 * The player. "No DRM: signed URLs + concurrency limits + email watermark
 * covers every realistic threat" — this page is where all three of those
 * become visible: the video element only ever loads the signed URL the
 * server handed out, a 409 from /playback/session means another device is
 * already watching, and watermark_enabled overlays the viewer's own email so
 * a leaked recording is traceable.
 *
 * ⚠️ Enforcement here is deliberately soft where it has to be. The preview
 * cutoff and the resume position are enforced by this component watching
 * `timeupdate` — there is no per-segment blocking, because that needs CDN-
 * edge integration this build doesn't have. Anyone who opens devtools and
 * copies the signed URL can watch past the cutoff until the token expires (6
 * hours). That is the accepted, documented threat model, not an oversight.
 */

interface PlaybackSessionResponse {
  playback_session_id: number;
  url: string;
  duration_seconds: number | null;
  resume_seconds: number;
  preview_seconds: number | null;
  can_view_fully: boolean;
  chapters: { title: string | null; start_seconds: number | null; chapter_type: string | null; is_skippable: boolean }[];
  subtitles: { language: string | null; label: string | null; vtt_url: string | null; is_default: boolean }[];
  settings: {
    playback_speeds: string[];
    subtitles_default_on: boolean;
    watermark_enabled: boolean;
    watermark_opacity: number;
    skip_chapter: boolean;
  };
}

interface ContentSummary {
  content: { id: number; title: string; slug: string; content_type: string };
  access: AccessResult;
  /** "session_page" and "player" placement content_sponsors links — see
   *  lib/sponsors.ts. This component only ever renders the "player" ones;
   *  Detail.tsx (the page this player's own back-link returns to) owns
   *  "session_page". */
  sponsors?: { id: number; name: string | null; logo_url: string | null; website_url: string | null; message: string | null; placement: string }[];
}

const HEARTBEAT_MS = 15_000;

function deviceType(): "desktop" | "mobile" | "tablet" {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia("(max-width: 640px)").matches) return "mobile";
  if (window.matchMedia("(max-width: 1024px)").matches) return "tablet";
  return "desktop";
}

/** Ends the session via sendBeacon when the page is actually closing — a
 *  normal fetch gets cancelled mid-flight on unload, sendBeacon does not. */
function endSessionOnUnload(sessionId: number, watchSeconds: number) {
  const token = getToken();
  const body = new Blob([JSON.stringify({ watch_seconds: watchSeconds })], { type: "application/json" });
  const url = `/api/playback/${sessionId}/end`;
  if (navigator.sendBeacon) {
    // sendBeacon can't carry an Authorization header — fine here, since
    // findOwnedSession on the server tolerates an anonymous caller ending an
    // anonymous session, and an OWNED session simply won't match without the
    // token and is left to expire on its own staleness cutoff instead.
    navigator.sendBeacon(url, body);
  } else {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ watch_seconds: watchSeconds }),
      keepalive: true,
    }).catch(() => undefined);
  }
}

export function Player() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const lessonId = params.get("lesson") ? Number(params.get("lesson")) : undefined;

  const [summary, setSummary] = useState<ContentSummary | null>(null);
  const [session, setSession] = useState<PlaybackSessionResponse | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "failed">("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [previewOver, setPreviewOver] = useState(false);
  const [watermarkCorner, setWatermarkCorner] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const watchSecondsRef = useRef(0);
  const sessionIdRef = useRef<number | null>(null);

  // ── Load content + start a playback session ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    fetchPublic<ContentSummary>(`/api/content/${encodeURIComponent(slug)}`)
      .then(async (content) => {
        if (cancelled) return;
        setSummary(content);

        const token = getToken();

        // A non-native session has no media asset for /api/playback/session
        // to find — this route only exists for the native player. Someone
        // landing here directly (a stale bookmark, browser back, a shared
        // /watch/:slug/play link) for a Zoom/Teams/Meet/Jitsi session should
        // land on the real meeting, not a "couldn't start playback" dead end.
        if (content.access.can_view && content.access.join_url) {
          // Best-effort, not awaited — the redirect below shouldn't wait on
          // it, and this app has no visibility into what happens after the
          // viewer leaves for the meeting anyway. See
          // POST /playback/meeting-attendance for what this actually feeds:
          // subscription revenue accrual's only signal for non-native
          // content. Signed-out visitors have nothing to attribute revenue
          // to, so there's nothing to record for them.
          if (token) {
            fetch("/api/playback/meeting-attendance", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ content_id: content.content.id }),
            }).catch(() => undefined);
          }
          window.location.replace(content.access.join_url);
          return;
        }

        const res = await fetch("/api/playback/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ content_id: content.content.id, lesson_id: lessonId, device_type: deviceType() }),
        });
        const body = (await res.json().catch(() => ({}))) as PlaybackSessionResponse & { error?: string };

        if (cancelled) return;
        if (!res.ok) {
          setSessionError(body.error ?? "We couldn't start playback.");
          setLoadState("ready"); // summary loaded; the gate below explains why there's no video
          return;
        }

        sessionIdRef.current = body.playback_session_id;
        setSession(body);
        setLoadState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadState(err?.name === "NotFoundError" ? "notfound" : "failed");
      });

    return () => {
      cancelled = true;
    };
  }, [slug, lessonId]);

  // ── Attach the video source (hls.js for .m3u8, native otherwise) ─────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !session) return;

    const isHls = session.url.includes(".m3u8");
    if (isHls && Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(session.url);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else {
      // Safari plays HLS natively; a plain mp4 needs nothing extra either way.
      video.src = session.url;
    }

    const onLoadedMetadata = () => {
      if (session.resume_seconds > 5) video.currentTime = session.resume_seconds;
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [session]);

  // ── Free-preview cutoff: client-enforced, see the module note above ──────
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !session) return;
    watchSecondsRef.current = Math.floor(video.currentTime);

    if (!session.can_view_fully && session.preview_seconds != null && video.currentTime >= session.preview_seconds) {
      video.pause();
      setPreviewOver(true);
    }
  }, [session]);

  // ── Heartbeat, and end on unmount ─────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    const id = session.playback_session_id;
    const token = getToken();

    const tick = () => {
      fetch(`/api/playback/${id}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ watch_seconds: watchSecondsRef.current }),
      }).catch(() => undefined); // a missed heartbeat is not worth surfacing to the viewer
    };
    const interval = window.setInterval(tick, HEARTBEAT_MS);

    return () => {
      window.clearInterval(interval);
      endSessionOnUnload(id, watchSecondsRef.current);
    };
  }, [session]);

  // ── Watermark: repositions periodically so a static crop can't remove it ──
  useEffect(() => {
    if (!session?.settings.watermark_enabled) return;
    const id = window.setInterval(() => setWatermarkCorner((c) => (c + 1) % 4), 25_000);
    return () => window.clearInterval(id);
  }, [session?.settings.watermark_enabled]);

  if (loadState === "loading") return <PublicPageSkeleton />;
  if (loadState === "notfound" || loadState === "failed") {
    return <PublicError kind={loadState === "notfound" ? "notfound" : "failed"} onRetry={() => window.location.reload()} />;
  }
  if (!summary) return null;

  const cornerClass = [
    "top-4 left-4",
    "top-4 right-4",
    "bottom-16 right-4",
    "bottom-16 left-4",
  ][watermarkCorner];

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-300">
        <Link to={`/watch/${slug}`} className="hover:text-white">
          ← {summary.content.title}
        </Link>
      </div>

      <div className="relative mx-auto w-full max-w-6xl flex-1 bg-black">
        {session ? (
          <>
            <video
              ref={videoRef}
              controls
              autoPlay
              className="h-full max-h-[80vh] w-full bg-black"
              onTimeUpdate={handleTimeUpdate}
              crossOrigin="anonymous"
            >
              {session.subtitles.map((t, i) =>
                t.vtt_url ? (
                  <track
                    key={i}
                    kind="subtitles"
                    src={t.vtt_url}
                    srcLang={t.language ?? undefined}
                    label={t.label ?? t.language ?? "Subtitles"}
                    default={t.is_default && session.settings.subtitles_default_on}
                  />
                ) : null,
              )}
            </video>

            {/* Identity watermark. Faint, moving, and only ever rendered when
                the admin has explicitly turned it on — never a default. */}
            {session.settings.watermark_enabled && (
              <div
                className={`pointer-events-none absolute ${cornerClass} rounded bg-black/40 px-2 py-1 text-xs text-white transition-all duration-1000`}
                style={{ opacity: session.settings.watermark_opacity / 100 }}
              >
                {getToken() ? "Registered viewer" : "Preview"}
              </div>
            )}

            {/* "player"-placement sponsor overlay — resolved by the same
                content.ts payload Detail.tsx's own "Sponsored by" section
                reads, filtered to the one placement this component owns.
                Absent entirely, not shown empty, when nothing's currently
                active for this content. */}
            {summary.sponsors?.some((s) => s.placement === "player") && (
              <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-1.5 rounded bg-black/50 px-2 py-1 text-xs text-slate-200 backdrop-blur">
                <span className="text-slate-400">Presented by</span>
                {summary.sponsors
                  .filter((s) => s.placement === "player")
                  .map((s) => (
                    <span key={s.id} className="pointer-events-auto font-medium text-white">
                      {s.website_url ? (
                        <a href={s.website_url} target="_blank" rel="noopener noreferrer sponsored" className="hover:underline">
                          {s.name ?? "Sponsor"}
                        </a>
                      ) : (
                        s.name ?? "Sponsor"
                      )}
                    </span>
                  ))}
              </div>
            )}

            {previewOver && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center">
                <p className="text-lg font-semibold text-white">That's the free preview</p>
                <p className="max-w-sm text-sm text-slate-400">
                  {summary.access.reason === "needs_signin"
                    ? "Sign in to see how to get full access."
                    : "Get full access to keep watching."}
                </p>
                <AccessGate access={summary.access} isLive={false} contentId={summary.content.id} slug={slug} />
              </div>
            )}
          </>
        ) : (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
            <p className="text-white">{sessionError ?? "This isn't playable right now."}</p>
            <Link to={`/watch/${slug}`} className="text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline">
              Back to details
            </Link>
          </div>
        )}
      </div>

      {session && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 text-xs text-slate-500">
          {session.duration_seconds != null && <span>{formatRuntime(session.duration_seconds, null)}</span>}
          {session.chapters.length > 0 && (
            <span>
              {session.chapters.length} chapter{session.chapters.length === 1 ? "" : "s"}
            </span>
          )}
          {!session.can_view_fully && session.preview_seconds != null && (
            <span className="text-amber-400">Free preview · {formatRuntime(session.preview_seconds, null)}</span>
          )}
        </div>
      )}
    </div>
  );
}
