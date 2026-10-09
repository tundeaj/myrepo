import { useState } from "react";
import { Panel, Field, selectClass, inputClass } from "./Panel";
import { Toggle } from "./Panel";
import { api } from "../../lib/api";

export type StreamProvider = "rtmp" | "external_url" | "vod";

interface Props {
  provider: StreamProvider;
  playbackId: string;
  externalUrl: string;
  vodAssetId: number | null;
  simulatedLive: boolean;
  sessionId?: number;
  onProvider: (v: StreamProvider) => void;
  onPlaybackId: (v: string) => void;
  onExternalUrl: (v: string) => void;
  onVodAssetId: (id: number | null) => void;
  onSimulatedLive: (v: boolean) => void;
}

const RTMP_INGEST = "rtmps://live.webinarflix.io/live";

export function StreamSourcePanel({
  provider,
  playbackId,
  externalUrl,
  vodAssetId,
  simulatedLive,
  sessionId,
  onProvider,
  onPlaybackId,
  onExternalUrl,
  onVodAssetId,
  onSimulatedLive,
}: Props) {
  const [revealed, setRevealed] = useState(false);
  const [streamKey, setStreamKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  async function handleReveal() {
    if (!sessionId) return;
    setRevealing(true);
    try {
      const res = await api<{ stream_key: string | null }>(`/sessions/${sessionId}/reveal-stream-key`, { method: "POST" });
      setStreamKey(res.stream_key);
      setRevealed(true);
    } finally {
      setRevealing(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  }

  const maskedKey = "•".repeat(32);

  return (
    <Panel title="Stream Source">
      <div className="space-y-4">
        <Field label="Provider">
          <select
            className={selectClass}
            value={provider}
            onChange={(e) => onProvider(e.target.value as StreamProvider)}
          >
            <option value="rtmp">RTMP Ingest (live stream)</option>
            <option value="external_url">External URL</option>
            <option value="vod">Pre-recorded VOD</option>
          </select>
        </Field>

        {provider === "rtmp" && (
          <div className="space-y-3">
            {/* Ingest URL */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Ingest URL (read-only)</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                <span className="flex-1 truncate font-mono text-xs text-slate-300">{RTMP_INGEST}</span>
                <button
                  type="button"
                  onClick={() => copy(RTMP_INGEST)}
                  className="text-xs text-slate-400 hover:text-slate-200"
                >
                  {copyFeedback ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Stream key */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Stream Key</label>
              <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                <span className="flex-1 font-mono text-xs text-slate-300">
                  {revealed && streamKey ? streamKey : maskedKey}
                </span>
                {!revealed && sessionId && (
                  <button
                    type="button"
                    disabled={revealing}
                    onClick={handleReveal}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {revealing ? "Revealing…" : "Reveal"}
                  </button>
                )}
                {revealed && streamKey && (
                  <button
                    type="button"
                    onClick={() => copy(streamKey)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    {copyFeedback ? "Copied!" : "Copy"}
                  </button>
                )}
              </div>
              {!sessionId && (
                <p className="mt-1 text-xs text-slate-600">Save the session first to generate a stream key.</p>
              )}
            </div>

            {/* Red notice */}
            <div className="flex items-start gap-2 rounded-lg border border-red-800/40 bg-red-900/20 p-3">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <p className="text-xs text-red-400">
                <strong>Never share this key.</strong> Anyone with this key can broadcast to this session.
              </p>
            </div>
          </div>
        )}

        {provider === "external_url" && (
          <Field label="Stream URL" hint="Paste an HLS (m3u8), MP4, or embed URL.">
            <input
              type="url"
              className={inputClass}
              value={externalUrl}
              onChange={(e) => onExternalUrl(e.target.value)}
              placeholder="https://stream.example.com/live/playlist.m3u8"
            />
          </Field>
        )}

        {provider === "vod" && (
          <div className="space-y-3">
            <Field label="Playback ID / Asset" hint="Enter the media asset ID from the Media Library.">
              <input
                type="number"
                className={inputClass}
                value={vodAssetId ?? ""}
                onChange={(e) => onVodAssetId(e.target.value ? Number(e.target.value) : null)}
                placeholder="Asset ID"
              />
            </Field>
            <Toggle
              label="Simulated live"
              description="Stream the pre-recorded video as if it were happening live. Viewers will not be able to scrub."
              checked={simulatedLive}
              onChange={onSimulatedLive}
            />
          </div>
        )}
      </div>
    </Panel>
  );
}
