import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { useAutosave } from "../../hooks/useAutosave";
import { useToast } from "../../components/Toast";

import { DetailsPanel } from "../../components/session/DetailsPanel";
import { SchedulePanel } from "../../components/session/SchedulePanel";
import { SpeakersPanel } from "../../components/session/SpeakersPanel";
import type { SessionSpeaker } from "../../components/session/SpeakersPanel";
import { ClassificationPanel } from "../../components/session/ClassificationPanel";
import { InteractionPanel } from "../../components/session/InteractionPanel";
import type { SessionConfig } from "../../components/session/InteractionPanel";
import { ResourcesPanel } from "../../components/session/ResourcesPanel";
import type { Resource } from "../../components/session/ResourcesPanel";
import { AdvertisementPanel } from "../../components/session/AdvertisementPanel";
import { ArtworkPanel } from "../../components/session/ArtworkPanel";
import { StreamSourcePanel } from "../../components/session/StreamSourcePanel";
import type { StreamProvider } from "../../components/session/StreamSourcePanel";
import { MeetingProviderPanel } from "../../components/session/MeetingProviderPanel";
import type { MeetingProvider } from "../../components/session/MeetingProviderPanel";
import { AccessPricingPanel } from "../../components/session/AccessPricingPanel";
import type { AccessLevel, PriceMode } from "../../components/session/AccessPricingPanel";
import { SimulcastPanel } from "../../components/session/SimulcastPanel";
import type { RestreamTarget } from "../../components/session/SimulcastPanel";
import { VisibilityPanel } from "../../components/session/VisibilityPanel";
import { SEOPanel } from "../../components/session/SEOPanel";
import { StatusBadge } from "../../components/StatusBadge";
import type { ContentStatus } from "../../components/StatusBadge";
import { Skeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";

// ─── FormState ────────────────────────────────────────────────────────────────
interface FormState {
  // Details
  title: string;
  slug: string;
  shortDescription: string;
  descriptionHtml: string;

  // Schedule
  scheduledDate: string;
  scheduledTime: string;
  timezone: string;
  durationMinutes: string;
  registrationClosesAt: string;
  capacity: string;

  // Speakers
  speakers: SessionSpeaker[];

  // Classification
  categoryIds: number[];
  sessionFormat: string;
  language: string;
  contentRating: string;
  searchTags: string[];

  // Interaction
  sessionConfig: SessionConfig;

  // Resources
  resources: Resource[];

  // Ads
  preRollAdId: number | null;
  midRollAdId: number | null;
  midRollOffsetSeconds: number | null;

  // Artwork
  masterImageUrl: string;
  focalX: number;
  focalY: number;
  imageOverrides: Record<string, string>;

  // Stream source
  streamProvider: StreamProvider;
  playbackId: string;
  externalUrl: string;
  vodAssetId: number | null;
  simulatedLive: boolean;

  // Meeting platform — meetingProvider is the only one of these an admin
  // sets directly; the rest are written by the server (syncMeetingProvider,
  // routes/sessions.ts) and only ever read here, never sent back in a save.
  meetingProvider: MeetingProvider;
  meetingJoinUrl: string | null;
  meetingHostUrl: string | null;
  meetingSyncError: string | null;
  meetingSyncedAt: string | null;

  // Access & Pricing
  accessLevel: AccessLevel;
  priceMode: PriceMode;
  priceNgn: string;
  compareAtPriceNgn: string;
  suggestedPriceNgn: string;
  minimumPriceNgn: string;
  freePreviewSeconds: string;

  // Simulcast
  restreamEnabled: boolean;
  restreamCutoffMinutes: string;
  restreamTargets: RestreamTarget[];

  // Visibility
  status: ContentStatus;
  publishMode: "immediate" | "scheduled";
  publishAt: string;
  isFeatured: boolean;
  showInHero: boolean;
  isActive: boolean;

  // SEO
  seoTitle: string;
  seoCanonicalUrl: string;
  seoMetaDescription: string;
}

function defaultForm(): FormState {
  return {
    title: "",
    slug: "",
    shortDescription: "",
    descriptionHtml: "",
    scheduledDate: "",
    scheduledTime: "10:00",
    timezone: "Africa/Lagos",
    durationMinutes: "60",
    registrationClosesAt: "",
    capacity: "",
    speakers: [],
    categoryIds: [],
    sessionFormat: "",
    language: "en",
    contentRating: "general",
    searchTags: [],
    sessionConfig: {
      chat_enabled: true,
      qa_enabled: true,
      polls_enabled: false,
      chat_moderated: true,
      allow_anonymous_qa: true,
    },
    resources: [],
    preRollAdId: null,
    midRollAdId: null,
    midRollOffsetSeconds: null,
    masterImageUrl: "",
    focalX: 50,
    focalY: 50,
    imageOverrides: {},
    streamProvider: "rtmp",
    playbackId: "",
    externalUrl: "",
    vodAssetId: null,
    simulatedLive: false,
    meetingProvider: "native",
    meetingJoinUrl: null,
    meetingHostUrl: null,
    meetingSyncError: null,
    meetingSyncedAt: null,
    accessLevel: "registered",
    priceMode: "fixed",
    priceNgn: "",
    compareAtPriceNgn: "",
    suggestedPriceNgn: "",
    minimumPriceNgn: "",
    freePreviewSeconds: "0",
    restreamEnabled: false,
    restreamCutoffMinutes: "",
    restreamTargets: [],
    status: "draft",
    publishMode: "immediate",
    publishAt: "",
    isFeatured: false,
    showInHero: false,
    isActive: true,
    seoTitle: "",
    seoCanonicalUrl: "",
    seoMetaDescription: "",
  };
}

function sessionToForm(s: Record<string, any>): FormState {
  const startAt = s.scheduled_start_at ? new Date(s.scheduled_start_at) : null;
  const closesAt = s.registration_closes_at ? new Date(s.registration_closes_at) : null;
  const publishAt = s.publish_at ? new Date(s.publish_at) : null;

  return {
    title: s.title ?? "",
    slug: s.slug ?? "",
    shortDescription: s.short_description ?? "",
    descriptionHtml: s.description_html ?? "",
    scheduledDate: startAt ? startAt.toISOString().slice(0, 10) : "",
    scheduledTime: startAt ? startAt.toISOString().slice(11, 16) : "10:00",
    timezone: s.timezone ?? "Africa/Lagos",
    durationMinutes: String(s.scheduled_duration_minutes ?? "60"),
    registrationClosesAt: closesAt ? closesAt.toISOString().slice(0, 16) : "",
    capacity: s.capacity ? String(s.capacity) : "",
    speakers: (s.speakers ?? []).map((cs: any) => ({
      speaker_id: cs.speaker_id,
      role: cs.role,
      revenue_share_pct: Number(cs.revenue_share_pct) || 0,
      full_name: cs.speaker?.full_name,
      title: cs.speaker?.title,
      organisation: cs.speaker?.organisation,
      master_image_url: cs.speaker?.master_image_url,
    })),
    categoryIds: s.category_ids ?? [],
    sessionFormat: s.session_format ?? "",
    language: s.language ?? "en",
    contentRating: s.content_rating ?? "general",
    searchTags: s.search_tags ? s.search_tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
    sessionConfig: s.session_config ?? {
      chat_enabled: true,
      qa_enabled: true,
      polls_enabled: false,
      chat_moderated: true,
      allow_anonymous_qa: true,
    },
    resources: (s.resources ?? []).map((r: any) => ({
      id: r.id,
      title: r.title ?? "",
      file_url: r.file_url ?? "",
      file_type: r.file_type ?? "",
      file_size_kb: r.file_size_kb,
      requires_entitlement: r.requires_entitlement ?? true,
    })),
    preRollAdId: s.pre_roll_ad_id ?? null,
    midRollAdId: s.mid_roll_ad_id ?? null,
    midRollOffsetSeconds: s.mid_roll_offset_seconds ?? null,
    masterImageUrl: s.master_image_url ?? "",
    focalX: s.focal_x ?? 50,
    focalY: s.focal_y ?? 50,
    imageOverrides: s.image_overrides ? JSON.parse(s.image_overrides) : {},
    streamProvider: (s.stream_provider as StreamProvider) ?? "rtmp",
    playbackId: s.playback_id ?? "",
    externalUrl: "",
    vodAssetId: null,
    simulatedLive: false,
    meetingProvider: (s.meeting_provider as MeetingProvider) ?? "native",
    meetingJoinUrl: s.meeting_join_url ?? null,
    meetingHostUrl: s.meeting_host_url ?? null,
    meetingSyncError: s.meeting_sync_error ?? null,
    meetingSyncedAt: s.meeting_synced_at ?? null,
    accessLevel: (s.access_level as AccessLevel) ?? "registered",
    priceMode: (s.price_mode as PriceMode) ?? "fixed",
    priceNgn: s.price_ngn ? String(s.price_ngn) : "",
    compareAtPriceNgn: s.compare_at_price_ngn ? String(s.compare_at_price_ngn) : "",
    suggestedPriceNgn: s.suggested_price_ngn ? String(s.suggested_price_ngn) : "",
    minimumPriceNgn: s.minimum_price_ngn ? String(s.minimum_price_ngn) : "",
    freePreviewSeconds: String(s.free_preview_seconds ?? 0),
    restreamEnabled: s.restream_enabled ?? false,
    restreamCutoffMinutes: s.restream_cutoff_minutes ? String(s.restream_cutoff_minutes) : "",
    restreamTargets: (s.restream_targets ?? []).map((t: any) => ({
      id: t.id,
      platform: t.platform,
      rtmp_url: t.rtmp_url ?? "",
      stream_key: "",
      stream_key_set: t.stream_key_set ?? false,
      is_enabled: t.is_enabled ?? false,
    })),
    status: (s.status as ContentStatus) ?? "draft",
    publishMode: s.publish_at ? "scheduled" : "immediate",
    publishAt: publishAt ? publishAt.toISOString().slice(0, 16) : "",
    isFeatured: s.is_featured ?? false,
    showInHero: s.show_in_hero ?? false,
    isActive: s.is_active ?? true,
    seoTitle: s.seo_title ?? "",
    seoCanonicalUrl: s.seo_canonical_url ?? "",
    seoMetaDescription: s.seo_meta_description ?? "",
  };
}

function formToPayload(form: FormState, status: "draft" | "registration_open") {
  const scheduledStartAt =
    form.scheduledDate && form.scheduledTime
      ? new Date(`${form.scheduledDate}T${form.scheduledTime}:00`).toISOString()
      : null;

  return {
    title: form.title,
    slug: form.slug || undefined,
    short_description: form.shortDescription || null,
    description_html: form.descriptionHtml || null,
    scheduled_start_at: scheduledStartAt,
    timezone: form.timezone,
    scheduled_duration_minutes: parseInt(form.durationMinutes) || null,
    registration_closes_at: form.registrationClosesAt ? new Date(form.registrationClosesAt).toISOString() : null,
    capacity: parseInt(form.capacity) || null,
    session_format: form.sessionFormat || null,
    language: form.language,
    content_rating: form.contentRating,
    search_tags: form.searchTags.join(",") || null,
    stream_provider: form.streamProvider,
    playback_id: form.playbackId || null,
    meeting_provider: form.meetingProvider,
    access_level: form.accessLevel,
    price_mode: form.priceMode,
    price_ngn: parseFloat(form.priceNgn) || null,
    compare_at_price_ngn: parseFloat(form.compareAtPriceNgn) || null,
    suggested_price_ngn: parseFloat(form.suggestedPriceNgn) || null,
    minimum_price_ngn: parseFloat(form.minimumPriceNgn) || null,
    free_preview_seconds: parseInt(form.freePreviewSeconds) || 0,
    master_image_url: form.masterImageUrl || null,
    focal_x: form.focalX,
    focal_y: form.focalY,
    image_overrides: Object.keys(form.imageOverrides).length ? JSON.stringify(form.imageOverrides) : null,
    pre_roll_ad_id: form.preRollAdId,
    mid_roll_ad_id: form.midRollAdId,
    mid_roll_offset_seconds: form.midRollOffsetSeconds,
    restream_enabled: form.restreamEnabled,
    restream_cutoff_minutes: parseInt(form.restreamCutoffMinutes) || null,
    is_featured: form.isFeatured,
    show_in_hero: form.showInHero,
    is_active: form.isActive,
    publish_at: form.publishMode === "scheduled" && form.publishAt
      ? new Date(form.publishAt).toISOString()
      : null,
    status,
    seo_title: form.seoTitle || null,
    seo_canonical_url: form.seoCanonicalUrl || null,
    seo_meta_description: form.seoMetaDescription || null,
    speakers: form.speakers.map((s) => ({
      speaker_id: s.speaker_id,
      role: s.role,
      revenue_share_pct: s.revenue_share_pct,
    })),
    category_ids: form.categoryIds,
    session_config: form.sessionConfig,
    resources: form.resources,
    restream_targets: form.restreamTargets.map((t) => ({
      id: t.id,
      platform: t.platform,
      rtmp_url: t.rtmp_url || null,
      stream_key: t.stream_key || null,
      is_enabled: t.is_enabled,
    })),
  };
}

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.title.trim()) errors.title = "Title is required.";
  if (!form.scheduledDate) errors.scheduledDate = "Start date is required.";
  if (!form.scheduledTime) errors.scheduledTime = "Start time is required.";
  if (!form.durationMinutes || parseInt(form.durationMinutes) < 1)
    errors.durationMinutes = "Duration must be at least 1 minute.";
  if (form.accessLevel === "purchase" && form.priceMode === "fixed" && !form.priceNgn)
    errors.priceNgn = "Price is required for paid content.";
  if (form.accessLevel === "purchase" && form.priceMode === "pay_what_you_can") {
    const sug = parseFloat(form.suggestedPriceNgn);
    const min = parseFloat(form.minimumPriceNgn);
    if (min > sug) errors.minimumPriceNgn = "Minimum must be ≤ suggested price.";
  }
  return errors;
}

const LIVE_STARTABLE = new Set(["scheduled", "registration_open", "starting_soon"]);

// ─── Component ────────────────────────────────────────────────────────────────
export function AddEditSession() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const sessionId = id ? Number(id) : undefined;
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(defaultForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [slugError, setSlugError] = useState<string | undefined>();
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isDirty, setIsDirty] = useState(false);
  const savedFormRef = useRef<FormState | null>(null);

  // Warn on tab close / reload while dirty. useBlocker (react-router) needs a
  // data router (createBrowserRouter + RouterProvider) to work at all — this
  // app's main.tsx uses plain BrowserRouter, so calling useBlocker here threw
  // "useBlocker must be used within a data router" on every render, crashing
  // this entire page with no error boundary to catch it. Confirmed via a real
  // browser check, not a type error — tsc has no way to see this. The native
  // beforeunload event needs no router at all and covers the highest-cost
  // case (losing everything since the last save, not just the last ~30s
  // autosave already protects against for in-app navigation).
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Load existing session for edit mode
  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    api<{ session: Record<string, any> }>(`/sessions/${sessionId}`)
      .then((res) => {
        const f = sessionToForm(res.session);
        setForm(f);
        savedFormRef.current = f;
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err.message ?? "Failed to load session.");
        setLoading(false);
      });
  }, [sessionId, isEdit]);

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
  }

  // Slug uniqueness check
  async function checkSlug(slug: string) {
    if (!slug) { setSlugError(undefined); return; }
    try {
      const res = await api<{ available: boolean }>(`/sessions/check-slug?slug=${encodeURIComponent(slug)}${sessionId ? `&exclude_id=${sessionId}` : ""}`);
      setSlugError(res.available ? undefined : "This slug is already taken.");
    } catch {
      // ignore check errors
    }
  }

  // Save function (used for both autosave and manual save)
  const doSave = useCallback(
    async (intentStatus: "draft" | "registration_open" = "draft", showToast = false) => {
      if (!form.title.trim()) return; // autosave guard
      setSaving(true);
      setAutosaveStatus("saving");
      try {
        const payload = formToPayload(form, intentStatus);
        const result = isEdit
          ? await api<{ session: Record<string, any> }>(`/sessions/${sessionId}`, { method: "PUT", body: JSON.stringify(payload) })
          : await api<{ session: Record<string, any> }>("/sessions", { method: "POST", body: JSON.stringify(payload) });
        const updated = sessionToForm(result.session);
        setForm(updated);
        savedFormRef.current = updated;
        setIsDirty(false);
        setAutosaveStatus("saved");
        if (showToast) toast("Session saved.", "success");
        if (!isEdit) {
          // Redirect to edit mode for the new session
          navigate(`/admin/sessions/${result.session.id}/edit`, { replace: true });
        }
      } catch (err: any) {
        setAutosaveStatus("error");
        if (showToast) toast(err.message ?? "Save failed.", "error");
      } finally {
        setSaving(false);
        setTimeout(() => setAutosaveStatus("idle"), 3000);
      }
    },
    [form, isEdit, sessionId, navigate, toast],
  );

  // Autosave every 30s when title is non-empty
  useAutosave(
    async () => {
      if (!form.title.trim()) return;
      await doSave("draft", false);
    },
    !!form.title.trim(),
    30_000,
  );

  async function handleSaveDraft() {
    const v = validate(form);
    if (v.title) { setErrors(v); return; }
    setErrors({});
    await doSave("draft", true);
  }

  async function handlePublish() {
    const v = validate(form);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      // Scroll to first error (simplified)
      const firstKey = Object.keys(v)[0];
      document.querySelector(`[data-field="${firstKey}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setErrors({});
    await doSave("registration_open", true);
    if (!errors.title) navigate("/admin/sessions");
  }

  const [liveBusy, setLiveBusy] = useState(false);

  async function handleGoLive() {
    if (!sessionId) return;
    setLiveBusy(true);
    try {
      const res = await api<{ session: Record<string, any> }>(`/sessions/${sessionId}/go-live`, { method: "POST" });
      setForm((f) => ({ ...f, status: res.session.status as ContentStatus }));
      if (savedFormRef.current) savedFormRef.current = { ...savedFormRef.current, status: res.session.status };
      toast("Session is live.", "success");
    } catch (err: any) {
      toast(err.message ?? "Failed to go live.", "error");
    } finally {
      setLiveBusy(false);
    }
  }

  async function handleEndLive() {
    if (!sessionId) return;
    if (!confirm("End this live session? Registrants will no longer see it as live.")) return;
    setLiveBusy(true);
    try {
      const res = await api<{ session: Record<string, any> }>(`/sessions/${sessionId}/end-live`, { method: "POST" });
      setForm((f) => ({ ...f, status: res.session.status as ContentStatus }));
      if (savedFormRef.current) savedFormRef.current = { ...savedFormRef.current, status: res.session.status };
      toast("Live session ended.", "success");
    } catch (err: any) {
      toast(err.message ?? "Failed to end the live session.", "error");
    } finally {
      setLiveBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setLoading(true)} />;
  }

  const speakerNames = form.speakers.map((s) => s.full_name).filter(Boolean) as string[];
  const firstCategoryId = form.categoryIds[0];

  return (
    <div className="min-h-screen">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/admin/sessions")}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            Sessions
          </button>
          <span className="text-slate-700">/</span>
          <h1 className="text-sm font-semibold text-slate-100">
            {isEdit ? form.title || "Edit Session" : "New Session"}
          </h1>
          {form.status && <StatusBadge status={form.status} />}
        </div>

        <div className="flex items-center gap-3">
          {/* Autosave status */}
          <AutosaveIndicator status={autosaveStatus} />

          {isEdit && form.status === "live" && (
            <button
              type="button"
              disabled={liveBusy}
              onClick={handleEndLive}
              className="rounded-lg border border-red-800 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-900/30 disabled:opacity-50"
            >
              {liveBusy ? "Ending…" : "End Live Session"}
            </button>
          )}
          {isEdit && LIVE_STARTABLE.has(form.status) && (
            <button
              type="button"
              disabled={liveBusy}
              onClick={handleGoLive}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              {liveBusy ? "Going live…" : "Go Live"}
            </button>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={handleSaveDraft}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Save Draft
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handlePublish}
            className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {saving ? "Saving…" : "Publish"}
          </button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-col gap-5 lg:flex-row">
          {/* Left column (58%) */}
          <div className="flex flex-col gap-5 lg:w-[58%]">
            <div data-field="title">
              <DetailsPanel
                title={form.title}
                slug={form.slug}
                shortDescription={form.shortDescription}
                descriptionHtml={form.descriptionHtml}
                onTitle={(v) => patchForm({ title: v })}
                onSlug={(v) => { patchForm({ slug: v }); checkSlug(v); }}
                onShortDescription={(v) => patchForm({ shortDescription: v })}
                onDescriptionHtml={(v) => patchForm({ descriptionHtml: v })}
                slugError={slugError}
                errors={errors}
                sessionId={sessionId}
                speakerNames={speakerNames}
              />
            </div>

            <div data-field="scheduledDate">
              <SchedulePanel
                scheduledDate={form.scheduledDate}
                scheduledTime={form.scheduledTime}
                timezone={form.timezone}
                durationMinutes={form.durationMinutes}
                registrationClosesAt={form.registrationClosesAt}
                capacity={form.capacity}
                onScheduledDate={(v) => patchForm({ scheduledDate: v })}
                onScheduledTime={(v) => patchForm({ scheduledTime: v })}
                onTimezone={(v) => patchForm({ timezone: v })}
                onDurationMinutes={(v) => patchForm({ durationMinutes: v })}
                onRegistrationClosesAt={(v) => patchForm({ registrationClosesAt: v })}
                onCapacity={(v) => patchForm({ capacity: v })}
                errors={errors}
              />
            </div>

            <SpeakersPanel
              speakers={form.speakers}
              onChange={(speakers) => patchForm({ speakers })}
            />

            <ClassificationPanel
              categoryIds={form.categoryIds}
              sessionFormat={form.sessionFormat}
              language={form.language}
              contentRating={form.contentRating}
              searchTags={form.searchTags}
              onCategoryIds={(ids) => patchForm({ categoryIds: ids })}
              onSessionFormat={(v) => patchForm({ sessionFormat: v })}
              onLanguage={(v) => patchForm({ language: v })}
              onContentRating={(v) => patchForm({ contentRating: v })}
              onSearchTags={(tags) => patchForm({ searchTags: tags })}
            />

            <InteractionPanel
              config={form.sessionConfig}
              onChange={(sessionConfig) => patchForm({ sessionConfig })}
            />

            <ResourcesPanel
              resources={form.resources}
              onChange={(resources) => patchForm({ resources })}
            />

            <AdvertisementPanel
              accessLevel={form.accessLevel}
              preRollAdId={form.preRollAdId}
              midRollAdId={form.midRollAdId}
              midRollOffsetSeconds={form.midRollOffsetSeconds}
              onPreRollAdId={(v) => patchForm({ preRollAdId: v })}
              onMidRollAdId={(v) => patchForm({ midRollAdId: v })}
              onMidRollOffsetSeconds={(v) => patchForm({ midRollOffsetSeconds: v })}
            />
          </div>

          {/* Right column (42%) */}
          <div className="flex flex-col gap-5 lg:flex-1">
            <ArtworkPanel
              masterImageUrl={form.masterImageUrl}
              focalX={form.focalX}
              focalY={form.focalY}
              imageOverrides={form.imageOverrides}
              onMasterImageUrl={(v) => patchForm({ masterImageUrl: v })}
              onFocalX={(v) => patchForm({ focalX: v })}
              onFocalY={(v) => patchForm({ focalY: v })}
              onImageOverrides={(v) => patchForm({ imageOverrides: v })}
            />

            <MeetingProviderPanel
              provider={form.meetingProvider}
              onProvider={(v) => patchForm({ meetingProvider: v })}
              joinUrl={form.meetingJoinUrl}
              hostUrl={form.meetingHostUrl}
              syncError={form.meetingSyncError}
              syncedAt={form.meetingSyncedAt}
              sessionId={sessionId}
            />

            {form.meetingProvider === "native" && (
              <StreamSourcePanel
                provider={form.streamProvider}
                playbackId={form.playbackId}
                externalUrl={form.externalUrl}
                vodAssetId={form.vodAssetId}
                simulatedLive={form.simulatedLive}
                sessionId={sessionId}
                onProvider={(v) => patchForm({ streamProvider: v })}
                onPlaybackId={(v) => patchForm({ playbackId: v })}
                onExternalUrl={(v) => patchForm({ externalUrl: v })}
                onVodAssetId={(v) => patchForm({ vodAssetId: v })}
                onSimulatedLive={(v) => patchForm({ simulatedLive: v })}
              />
            )}

            <AccessPricingPanel
              accessLevel={form.accessLevel}
              priceMode={form.priceMode}
              priceNgn={form.priceNgn}
              compareAtPriceNgn={form.compareAtPriceNgn}
              suggestedPriceNgn={form.suggestedPriceNgn}
              minimumPriceNgn={form.minimumPriceNgn}
              freePreviewSeconds={form.freePreviewSeconds}
              onAccessLevel={(v) => patchForm({ accessLevel: v })}
              onPriceMode={(v) => patchForm({ priceMode: v })}
              onPriceNgn={(v) => patchForm({ priceNgn: v })}
              onCompareAtPriceNgn={(v) => patchForm({ compareAtPriceNgn: v })}
              onSuggestedPriceNgn={(v) => patchForm({ suggestedPriceNgn: v })}
              onMinimumPriceNgn={(v) => patchForm({ minimumPriceNgn: v })}
              onFreePreviewSeconds={(v) => patchForm({ freePreviewSeconds: v })}
              errors={errors}
            />

            <SimulcastPanel
              enabled={form.restreamEnabled}
              cutoffMinutes={form.restreamCutoffMinutes}
              targets={form.restreamTargets}
              onEnabled={(v) => patchForm({ restreamEnabled: v })}
              onCutoffMinutes={(v) => patchForm({ restreamCutoffMinutes: v })}
              onTargets={(targets) => patchForm({ restreamTargets: targets })}
              sessionId={sessionId}
            />

            <VisibilityPanel
              status={form.status}
              publishMode={form.publishMode}
              publishAt={form.publishAt}
              isFeatured={form.isFeatured}
              showInHero={form.showInHero}
              isActive={form.isActive}
              onPublishMode={(v) => patchForm({ publishMode: v })}
              onPublishAt={(v) => patchForm({ publishAt: v })}
              onIsFeatured={(v) => patchForm({ isFeatured: v })}
              onShowInHero={(v) => patchForm({ showInHero: v })}
              onIsActive={(v) => patchForm({ isActive: v })}
            />

            {/* Audience Rating — read-only in edit mode */}
            {isEdit && (
              <RatingPanel />
            )}

            <SEOPanel
              seoTitle={form.seoTitle}
              seoCanonicalUrl={form.seoCanonicalUrl}
              seoMetaDescription={form.seoMetaDescription}
              onSeoTitle={(v) => patchForm({ seoTitle: v })}
              onSeoCanonicalUrl={(v) => patchForm({ seoCanonicalUrl: v })}
              onSeoMetaDescription={(v) => patchForm({ seoMetaDescription: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AutosaveIndicator ────────────────────────────────────────────────────────
function AutosaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  return (
    <span
      className={`text-xs ${
        status === "saving"
          ? "text-slate-500"
          : status === "saved"
          ? "text-emerald-400"
          : "text-red-400"
      }`}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Save failed"}
    </span>
  );
}

// ─── RatingPanel (read-only) ──────────────────────────────────────────────────
function RatingPanel() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-100">Audience Rating</h2>
      <div className="flex items-center gap-3 text-slate-400">
        <div className="flex">
          {Array.from({ length: 5 }).map((_, i) => (
            <svg key={i} className="h-4 w-4 text-slate-700" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          ))}
        </div>
        <span className="text-xs text-slate-600">No ratings yet. This is read-only once reviews come in.</span>
      </div>
    </div>
  );
}
