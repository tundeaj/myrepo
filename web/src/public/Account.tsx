import { useState, useEffect, useCallback } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth, type AuthUser } from "../lib/AuthContext";
import { buildImageUrl } from "./lib/images";
import { fieldClass, submitClass, FormError, FormNotice, Label } from "./auth/AuthShell";

/**
 * The viewer's own account. Every request is scoped server-side by the token —
 * nothing here sends a user id, because nothing server-side accepts one.
 */

interface Preferences {
  timezone: string | null;
  language: string | null;
  data_saver: boolean;
  subtitles_on: boolean;
  autoplay_next: boolean;
  weekly_digest: boolean;
}

interface ConsentRow {
  policy_key: string | null;
  policy_version: number | null;
  granted: boolean;
  accepted_at: string;
}

interface Device {
  id: number;
  device_name: string | null;
  device_type: string | null;
  os: string | null;
  browser: string | null;
  last_seen_at: string;
  last_country: string | null;
  is_active: boolean;
}

interface NotificationPref {
  event_key: string;
  channel: "email" | "in_app" | "whatsapp";
  is_enabled: boolean;
}

interface AccountPayload {
  user: AuthUser & {
    country: string;
    timezone: string;
    industry: string | null;
    job_role: string | null;
    company_name: string | null;
    email_verified: boolean;
  };
  preferences: Preferences | null;
  notification_preferences: NotificationPref[];
  consent: ConsentRow[];
  consent_history: ConsentRow[];
}

// A label + one-line description per NOTIFICATION_EVENT_KEYS entry
// (server/src/constants/notificationEvents.ts) — the canonical list this
// mirrors. 'email' is the only channel rendered here: it's the only one
// anything in this app actually sends through (in_app/whatsapp exist on the
// schema's enum but nothing sends via either yet), so a toggle for them
// would control a feature that doesn't exist.
const NOTIFICATION_LABELS: Record<string, { label: string; description: string }> = {
  session_reminder: { label: "Session reminders", description: "Before a webinar you're registered for starts" },
  session_starting: { label: "Session starting now", description: "The moment a session you're registered for goes live" },
  replay_ready: { label: "Replay ready", description: "When a recording of a session you attended is available" },
  new_in_category: { label: "New in your categories", description: "New content published in a category you follow" },
  course_updated: { label: "Course updates", description: "When a course you're enrolled in adds or changes content" },
  community_reply: { label: "Community replies", description: "When someone replies to your post in a Community space" },
  assignment_feedback: { label: "Assignment feedback", description: "When an instructor leaves feedback on your work" },
  payment_receipt: { label: "Payment receipts", description: "A confirmation every time you're charged" },
  payment_failed: { label: "Payment failures", description: "When a charge or renewal doesn't go through" },
  certificate_issued: { label: "Certificates", description: "When you earn a completion certificate" },
};

interface RegistrationRow {
  id: number;
  status: string;
  registered_at: string;
  content: {
    id: number;
    slug: string;
    title: string;
    master_image_url: string | null;
    status: string;
    scheduled_start_at: string | null;
    scheduled_duration_minutes: number | null;
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

export function Account() {
  const { status, logout } = useAuth();
  const [data, setData] = useState<AccountPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState({ full_name: "", job_role: "", company_name: "" });

  const load = useCallback(() => {
    api<AccountPayload>("/account")
      .then((payload) => {
        setData(payload);
        setProfile({
          full_name: payload.user.full_name ?? "",
          job_role: payload.user.job_role ?? "",
          company_name: payload.user.company_name ?? "",
        });
      })
      .catch((err) => setError(err?.message ?? "We couldn't load your account."));
  }, []);

  useEffect(() => {
    if (status === "signed-in") load();
  }, [status, load]);

  if (status === "signed-out") return <Navigate to="/signin" state={{ from: "/account" }} replace />;

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api("/account/profile", { method: "PUT", body: JSON.stringify(profile) });
      setNotice("Saved.");
    } catch (err: any) {
      setError(err?.message ?? "We couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  async function setPreference(patch: Partial<Preferences>) {
    if (!data) return;
    // Optimistic: these are toggles, and waiting on a round trip to move a
    // switch feels broken. A failure reloads the true state.
    setData({ ...data, preferences: { ...(data.preferences as Preferences), ...patch } });
    try {
      await api("/account/preferences", { method: "PUT", body: JSON.stringify(patch) });
    } catch {
      setError("That preference didn't save.");
      load();
    }
  }

  async function setNotificationPref(eventKey: string, enabled: boolean) {
    if (!data) return;
    const existing = data.notification_preferences.find((p) => p.event_key === eventKey && p.channel === "email");
    // Optimistic, same reasoning as setPreference() above — a toggle should
    // feel instant. A failure reloads the true state.
    const nextPrefs = existing
      ? data.notification_preferences.map((p) => (p === existing ? { ...p, is_enabled: enabled } : p))
      : [...data.notification_preferences, { event_key: eventKey, channel: "email" as const, is_enabled: enabled }];
    setData({ ...data, notification_preferences: nextPrefs });
    try {
      await api("/account/notifications", {
        method: "PUT",
        body: JSON.stringify({ preferences: [{ event_key: eventKey, channel: "email", is_enabled: enabled }] }),
      });
    } catch {
      setError("That notification setting didn't save.");
      load();
    }
  }

  async function withdrawConsent(policyKey: string, granted: boolean) {
    try {
      await api("/account/consent", {
        method: "POST",
        body: JSON.stringify({ policy_key: policyKey, granted }),
      });
      setNotice(granted ? "Consent recorded." : "Consent withdrawn.");
      load();
    } catch (err: any) {
      setError(err?.message ?? "We couldn't record that.");
    }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-6 py-24">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-900/60" />
        ))}
      </div>
    );
  }

  const prefs = data.preferences;

  return (
    <div className="min-h-screen bg-[#0b0b0f]">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-16">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Your account</h1>
            <p className="mt-1 text-sm text-slate-500">{data.user.email}</p>
          </div>
          <Link to="/" className="text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline">
            Back to browsing
          </Link>
        </div>

        {!data.user.email_verified && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Your email isn't confirmed yet. Some things stay locked until it is.
          </div>
        )}

        <FormError message={error} />
        <FormNotice message={notice} />

        <Section title="Profile">
          <form onSubmit={saveProfile} className="space-y-4">
            <div>
              <Label htmlFor="full_name">Full name</Label>
              <input
                id="full_name"
                className={fieldClass}
                value={profile.full_name}
                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="job_role">Job role</Label>
                <input
                  id="job_role"
                  className={fieldClass}
                  value={profile.job_role}
                  onChange={(e) => setProfile({ ...profile, job_role: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="company_name">Company</Label>
                <input
                  id="company_name"
                  className={fieldClass}
                  value={profile.company_name}
                  onChange={(e) => setProfile({ ...profile, company_name: e.target.value })}
                />
              </div>
            </div>
            <button type="submit" disabled={saving} className={`${submitClass} sm:w-auto sm:px-6`}>
              {saving ? "Saving…" : "Save"}
            </button>
          </form>
        </Section>

        {prefs && (
          <Section title="Playback & email">
            <div className="space-y-1">
              {(
                [
                  ["subtitles_on", "Subtitles on by default"],
                  ["autoplay_next", "Autoplay the next item"],
                  ["data_saver", "Data saver — cap streaming quality"],
                  ["weekly_digest", "Weekly email digest"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-1 py-2.5 text-sm text-slate-300 hover:bg-slate-900/60"
                >
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={prefs[key]}
                    onChange={(e) => setPreference({ [key]: e.target.checked })}
                    className="h-4 w-4 accent-white"
                  />
                </label>
              ))}
            </div>
          </Section>
        )}

        <Section title="Notifications">
          <div className="space-y-1">
            {Object.entries(NOTIFICATION_LABELS).map(([eventKey, { label, description }]) => {
              const row = data.notification_preferences.find((p) => p.event_key === eventKey && p.channel === "email");
              // Absent row = default enabled — the same fallback
              // routes/community.ts's own notifyReplyApproved() uses, for an
              // account that signed up before preferences were seeded here.
              const enabled = row?.is_enabled ?? true;
              return (
                <label
                  key={eventKey}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-1 py-2.5 text-sm text-slate-300 hover:bg-slate-900/60"
                >
                  <span>
                    <span className="block">{label}</span>
                    <span className="block text-xs text-slate-600">{description}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setNotificationPref(eventKey, e.target.checked)}
                    className="h-4 w-4 flex-shrink-0 accent-white"
                  />
                </label>
              );
            })}
          </div>
          <p className="text-xs text-slate-600">Email only, for now — this is where that will expand if other channels are added.</p>
        </Section>

        <Section title="Consent">
          {!data.consent.length ? (
            <p className="text-sm text-slate-500">No consent records yet.</p>
          ) : (
            <div className="space-y-3">
              {data.consent.map((c) => (
                <div key={c.policy_key} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">
                      {(c.policy_key ?? "").replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-slate-600">
                      {c.granted ? "Granted" : "Withdrawn"}{" "}
                      {new Date(c.accepted_at).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => withdrawConsent(c.policy_key ?? "", !c.granted)}
                    className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    {c.granted ? "Withdraw" : "Grant again"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Withdrawal writes a new row rather than editing the old one, so the
              full history stays intact — that is what makes the record worth
              anything if it is ever questioned. */}
          <p className="text-xs text-slate-600">
            Every change is recorded as a new entry. Nothing is overwritten or deleted.
          </p>
        </Section>

        <Section title="Devices">
          <DeviceList />
        </Section>

        <button
          onClick={logout}
          className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-slate-800"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function DeviceList() {
  const [devices, setDevices] = useState<Device[] | null>(null);

  const load = useCallback(() => {
    api<{ devices: Device[] }>("/account/devices")
      .then((r) => setDevices(r.devices))
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => load(), [load]);

  async function signOutDevice(id: number) {
    await api(`/account/devices/${id}`, { method: "DELETE" }).catch(() => undefined);
    load();
  }

  if (!devices) return <div className="h-12 animate-pulse rounded-lg bg-slate-800/60" />;
  if (!devices.length) return <p className="text-sm text-slate-500">No devices recorded yet.</p>;

  return (
    <div className="space-y-2">
      {devices.map((d) => (
        <div key={d.id} className="flex items-center justify-between gap-4 text-sm">
          <div className="min-w-0">
            <p className="truncate text-slate-200">
              {d.device_name ?? [d.browser, d.os].filter(Boolean).join(" on ") ?? "Unknown device"}
            </p>
            <p className="text-xs text-slate-600">
              Last used {new Date(d.last_seen_at).toLocaleDateString("en-NG")}
              {d.last_country ? ` · ${d.last_country}` : ""}
              {!d.is_active ? " · signed out" : ""}
            </p>
          </div>
          {d.is_active && (
            <button
              onClick={() => signOutDevice(d.id)}
              className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Sign out
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── /account/registrations ───────────────────────────────────────────────────

export function MyRegistrations() {
  const { status } = useAuth();
  const [rows, setRows] = useState<RegistrationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ registrations: RegistrationRow[] }>("/registrations/mine")
      .then((r) => setRows(r.registrations))
      .catch((err) => setError(err?.message ?? "We couldn't load your registrations."));
  }, []);

  useEffect(() => {
    if (status === "signed-in") load();
  }, [status, load]);

  if (status === "signed-out") {
    return <Navigate to="/signin" state={{ from: "/account/registrations" }} replace />;
  }

  async function cancel(id: number) {
    await api(`/registrations/${id}`, { method: "DELETE" }).catch(() => undefined);
    load();
  }

  return (
    <div className="min-h-screen bg-[#0b0b0f]">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-16">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Your sessions</h1>
          <Link to="/account" className="text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline">
            Account
          </Link>
        </div>

        <FormError message={error} />

        {!rows ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-900/60" />
            ))}
          </div>
        ) : !rows.length ? (
          <p className="text-sm text-slate-500">
            You haven't registered for anything yet.{" "}
            <Link to="/browse" className="text-white underline-offset-4 hover:underline">
              Browse what's on
            </Link>
            .
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => {
              const upcoming =
                r.content.scheduled_start_at != null &&
                new Date(r.content.scheduled_start_at).getTime() > Date.now();
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-3"
                >
                  {r.content.master_image_url && (
                    <img
                      src={buildImageUrl(r.content.master_image_url, 160) ?? undefined}
                      alt=""
                      loading="lazy"
                      className="h-14 w-24 flex-shrink-0 rounded object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/watch/${r.content.slug}`}
                      className="block truncate text-sm font-medium text-slate-100 hover:underline"
                    >
                      {r.content.title}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {r.content.scheduled_start_at
                        ? new Date(r.content.scheduled_start_at).toLocaleString("en-NG", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "Time to be confirmed"}
                    </p>
                    {r.status === "waitlisted" && (
                      <span className="mt-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">
                        Waitlisted
                      </span>
                    )}
                  </div>
                  {upcoming && (
                    <button
                      onClick={() => cancel(r.id)}
                      className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
