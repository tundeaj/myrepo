import { useState, useEffect } from "react";
import { Panel, Field, selectClass } from "./Panel";
import { api } from "../../lib/api";

export type MeetingProvider = "native" | "zoom" | "teams" | "google_meet" | "jitsi";

interface ConnectionsResponse {
  connections: Array<{ provider: "google" | "microsoft" | "zoom"; external_account_email: string | null; connected_at: string }>;
  configured: Record<"google" | "microsoft" | "zoom", boolean>;
}

const PROVIDER_META: Record<Exclude<MeetingProvider, "native">, { label: string; identity: "google" | "microsoft" | "zoom" | null }> = {
  zoom: { label: "Zoom", identity: "zoom" },
  teams: { label: "Microsoft Teams", identity: "microsoft" },
  google_meet: { label: "Google Meet", identity: "google" },
  jitsi: { label: "Jitsi (no account needed)", identity: null },
};

interface Props {
  provider: MeetingProvider;
  onProvider: (v: MeetingProvider) => void;
  joinUrl: string | null;
  hostUrl: string | null;
  syncError: string | null;
  syncedAt: string | null;
  sessionId?: number;
}

/**
 * The one place meeting_provider gets chosen. 'native' keeps StreamSourcePanel
 * (rendered by the caller, not this component) as the source of truth; every
 * other value hides it — a Zoom/Teams/Meet/Jitsi session has nothing for
 * StreamSourcePanel's RTMP/VOD fields to configure.
 *
 * join_url/host_url/sync_error are read-only here on purpose — they're
 * written by lib/meetingProviders/ adapters on the server the moment this
 * form is saved with a non-native provider selected, never typed in by an
 * admin. See routes/sessions.ts's syncMeetingProvider().
 */
export function MeetingProviderPanel({ provider, onProvider, joinUrl, hostUrl, syncError, syncedAt, sessionId }: Props) {
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    api<ConnectionsResponse>("/provider-connections").then(setConnections).catch(() => setConnections(null));
  }, [joinUrl]); // re-check after a save, in case a connection was just used

  async function connect(identity: "google" | "microsoft" | "zoom") {
    setConnecting(true);
    try {
      const res = await api<{ authorize_url: string }>(`/provider-connections/${identity}/connect`);
      window.location.href = res.authorize_url;
    } catch {
      setConnecting(false);
    }
  }

  const meta = provider !== "native" ? PROVIDER_META[provider] : null;
  const isConnected = meta?.identity ? connections?.connections.some((c) => c.provider === meta.identity) : true;
  const isConfigured = meta?.identity ? (connections?.configured[meta.identity] ?? true) : true;

  return (
    <Panel title="Meeting Platform">
      <div className="space-y-4">
        <Field label="How does this session run?" hint="Native uses this app's own player and Stream Source settings below. Everything else hands the session to a third-party meeting, and the viewer's Join button follows the real meeting link.">
          <select className={selectClass} value={provider} onChange={(e) => onProvider(e.target.value as MeetingProvider)}>
            <option value="native">Native (Webinarflix player)</option>
            <option value="zoom">Zoom</option>
            <option value="teams">Microsoft Teams</option>
            <option value="google_meet">Google Meet</option>
            <option value="jitsi">Jitsi Meet</option>
          </select>
        </Field>

        {meta && (
          <div className="space-y-3">
            {meta.identity && !isConfigured && (
              <div className="rounded-lg border border-amber-800/40 bg-amber-900/20 p-3 text-xs text-amber-300">
                {meta.label} isn't configured on this platform yet — an administrator needs to add its OAuth Client ID and Secret before anyone can connect an account.
              </div>
            )}

            {meta.identity && isConfigured && !isConnected && (
              <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
                <span className="text-xs text-slate-400">Connect your {meta.label} account to create meetings under your name.</span>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => connect(meta.identity!)}
                  className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                >
                  {connecting ? "Redirecting…" : `Connect ${meta.label}`}
                </button>
              </div>
            )}

            {meta.identity && isConnected && (
              <p className="text-xs text-emerald-400">
                {meta.label} account connected
                {connections?.connections.find((c) => c.provider === meta.identity)?.external_account_email
                  ? ` as ${connections.connections.find((c) => c.provider === meta.identity)?.external_account_email}`
                  : ""}
                .
              </p>
            )}

            {!sessionId && (
              <p className="text-xs text-slate-600">Save the session to create the {meta.label} meeting.</p>
            )}

            {sessionId && syncError && (
              <div className="rounded-lg border border-red-800/40 bg-red-900/20 p-3 text-xs text-red-400">
                <strong>Meeting sync failed:</strong> {syncError}
              </div>
            )}

            {sessionId && !syncError && joinUrl && (
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Join link (shown to viewers)</label>
                  <div className="truncate rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">{joinUrl}</div>
                </div>
                {hostUrl && hostUrl !== joinUrl && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-400">Host / start link (admin only)</label>
                    <a href={hostUrl} target="_blank" rel="noopener noreferrer" className="block truncate rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-brand hover:underline">
                      {hostUrl}
                    </a>
                  </div>
                )}
                {syncedAt && <p className="text-xs text-slate-600">Synced {new Date(syncedAt).toLocaleString()}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
