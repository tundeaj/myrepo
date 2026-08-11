import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import { api } from "../../lib/api";
import { useAutosave } from "../../hooks/useAutosave";
import { useToast } from "../../components/Toast";

// Session panels reused as-is
import { DetailsPanel } from "../../components/session/DetailsPanel";
import { SpeakersPanel } from "../../components/session/SpeakersPanel";
import type { SessionSpeaker } from "../../components/session/SpeakersPanel";
import { ClassificationPanel } from "../../components/session/ClassificationPanel";
import { ResourcesPanel } from "../../components/session/ResourcesPanel";
import type { Resource } from "../../components/session/ResourcesPanel";
import { AdvertisementPanel } from "../../components/session/AdvertisementPanel";
import { AccessPricingPanel } from "../../components/session/AccessPricingPanel";
import type { AccessLevel, PriceMode } from "../../components/session/AccessPricingPanel";
import { VisibilityPanel } from "../../components/session/VisibilityPanel";
import { SEOPanel } from "../../components/session/SEOPanel";
import { StatusBadge } from "../../components/StatusBadge";
import type { ContentStatus } from "../../components/StatusBadge";
import { Skeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";

// Course-specific panels
import { OutcomesPanel } from "../../components/course/OutcomesPanel";
import type { CourseOutcomes } from "../../components/course/OutcomesPanel";
import { CurriculumPanel } from "../../components/course/CurriculumPanel";
import type { CourseModule } from "../../components/course/CurriculumPanel";
import { CertificationPanel } from "../../components/course/CertificationPanel";
import type { CertConfig } from "../../components/course/CertificationPanel";
import { DeliveryModePanel } from "../../components/course/DeliveryModePanel";
import { FreshnessPanel } from "../../components/course/FreshnessPanel";
import { CourseArtworkPanel } from "../../components/course/CourseArtworkPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssetInfo {
  id: number;
  title: string | null;
  duration_seconds: number | null;
  transcode_status: string;
  thumbnail_url: string | null;
}

interface FormState {
  // Details
  title: string;
  slug: string;
  shortDescription: string;
  descriptionHtml: string;

  // Outcomes
  outcomes: CourseOutcomes;

  // Classification
  categoryIds: number[];
  language: string;
  contentRating: string;
  searchTags: string[];

  // Speakers
  speakers: SessionSpeaker[];

  // Curriculum
  modules: CourseModule[];

  // Resources
  resources: Resource[];

  // Ads
  preRollAdId: number | null;
  midRollAdId: number | null;
  midRollOffsetSeconds: number | null;

  // Artwork + media
  masterImageUrl: string;
  focalX: number;
  focalY: number;
  imageOverrides: Record<string, string>;
  trailerAssetId: number | null;
  trailerAsset: AssetInfo | null;
  substituteAssetId: number | null;
  substituteAsset: AssetInfo | null;

  // Delivery mode
  isCohort: boolean;
  cohortStartDate: string;

  // Certification
  cert: CertConfig;

  // Freshness
  expiresAt: string;
  expiryAction: "archive" | "flag_for_review" | "hide_from_browse" | "";

  // Access & Pricing
  accessLevel: AccessLevel;
  priceMode: PriceMode;
  priceNgn: string;
  compareAtPriceNgn: string;
  suggestedPriceNgn: string;
  minimumPriceNgn: string;
  freePreviewSeconds: string;

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

// ─── Defaults ─────────────────────────────────────────────────────────────────

function defaultForm(): FormState {
  return {
    title: "",
    slug: "",
    shortDescription: "",
    descriptionHtml: "",
    outcomes: { objectives: [], prerequisites: [], target_audience: [] },
    categoryIds: [],
    language: "en",
    contentRating: "general",
    searchTags: [],
    speakers: [],
    modules: [],
    resources: [],
    preRollAdId: null,
    midRollAdId: null,
    midRollOffsetSeconds: null,
    masterImageUrl: "",
    focalX: 50,
    focalY: 50,
    imageOverrides: {},
    trailerAssetId: null,
    trailerAsset: null,
    substituteAssetId: null,
    substituteAsset: null,
    isCohort: false,
    cohortStartDate: "",
    cert: { enabled: false, title: "Certificate of Completion", hours: "" },
    expiresAt: "",
    expiryAction: "",
    accessLevel: "registered",
    priceMode: "fixed",
    priceNgn: "",
    compareAtPriceNgn: "",
    suggestedPriceNgn: "",
    minimumPriceNgn: "",
    freePreviewSeconds: "0",
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

// ─── courseToForm ──────────────────────────────────────────────────────────────

function courseToForm(c: Record<string, any>): FormState {
  const publishAt = c.publish_at ? new Date(c.publish_at) : null;
  const expiresAt = c.expires_at ? new Date(c.expires_at) : null;

  let outcomes: CourseOutcomes = { objectives: [], prerequisites: [], target_audience: [] };
  if (c.outcomes_json) {
    try { outcomes = JSON.parse(c.outcomes_json); } catch { /* ignore */ }
  }

  let cert: CertConfig = { enabled: false, title: "Certificate of Completion", hours: "" };
  if (c.cert_config_json) {
    try {
      const parsed = JSON.parse(c.cert_config_json);
      cert = { enabled: !!parsed.enabled, title: parsed.title || "Certificate of Completion", hours: String(parsed.hours || "") };
    } catch { /* ignore */ }
  }

  return {
    title: c.title ?? "",
    slug: c.slug ?? "",
    shortDescription: c.short_description ?? "",
    descriptionHtml: c.description_html ?? "",
    outcomes,
    categoryIds: c.category_ids ?? [],
    language: c.language ?? "en",
    contentRating: c.content_rating ?? "general",
    searchTags: c.search_tags ? c.search_tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
    speakers: (c.speakers ?? []).map((cs: any) => ({
      speaker_id: cs.speaker_id,
      role: cs.role,
      revenue_share_pct: Number(cs.revenue_share_pct) || 0,
      full_name: cs.speaker?.full_name,
      title: cs.speaker?.title,
      organisation: cs.speaker?.organisation,
      master_image_url: cs.speaker?.master_image_url,
    })),
    modules: (c.modules ?? []).map((mod: any) => ({
      id: mod.id,
      title: mod.title ?? "",
      drip_days_after_enrolment: mod.drip_days_after_enrolment ?? 0,
      display_order: mod.display_order ?? 0,
      lessons: (mod.lessons ?? []).map((lesson: any) => ({
        id: lesson.id,
        title: lesson.title ?? "",
        lesson_type: lesson.lesson_type ?? "vod",
        media_asset_id: lesson.media_asset_id ?? null,
        body_html: lesson.body_html ?? "",
        is_preview: lesson.is_preview ?? false,
        display_order: lesson.display_order ?? 0,
        asset: lesson.asset ?? null,
      })),
    })),
    resources: (c.resources ?? []).map((r: any) => ({
      id: r.id,
      title: r.title ?? "",
      file_url: r.file_url ?? "",
      file_type: r.file_type ?? "",
      file_size_kb: r.file_size_kb,
      requires_entitlement: r.requires_entitlement ?? true,
    })),
    preRollAdId: c.pre_roll_ad_id ?? null,
    midRollAdId: c.mid_roll_ad_id ?? null,
    midRollOffsetSeconds: c.mid_roll_offset_seconds ?? null,
    masterImageUrl: c.master_image_url ?? "",
    focalX: c.focal_x ?? 50,
    focalY: c.focal_y ?? 50,
    imageOverrides: c.image_overrides ? JSON.parse(c.image_overrides) : {},
    trailerAssetId: c.trailer_media_asset_id ?? null,
    trailerAsset: null, // not loaded in list — would come from a separate fetch
    substituteAssetId: c.substitute_media_asset_id ?? null,
    substituteAsset: null,
    isCohort: c.is_cohort ?? false,
    cohortStartDate: c.cohort_start_date ? String(c.cohort_start_date).slice(0, 10) : "",
    cert,
    expiresAt: expiresAt ? expiresAt.toISOString().slice(0, 16) : "",
    expiryAction: c.expiry_action ?? "",
    accessLevel: (c.access_level as AccessLevel) ?? "registered",
    priceMode: (c.price_mode as PriceMode) ?? "fixed",
    priceNgn: c.price_ngn ? String(c.price_ngn) : "",
    compareAtPriceNgn: c.compare_at_price_ngn ? String(c.compare_at_price_ngn) : "",
    suggestedPriceNgn: c.suggested_price_ngn ? String(c.suggested_price_ngn) : "",
    minimumPriceNgn: c.minimum_price_ngn ? String(c.minimum_price_ngn) : "",
    freePreviewSeconds: String(c.free_preview_seconds ?? 0),
    status: (c.status as ContentStatus) ?? "draft",
    publishMode: c.publish_at ? "scheduled" : "immediate",
    publishAt: publishAt ? publishAt.toISOString().slice(0, 16) : "",
    isFeatured: c.is_featured ?? false,
    showInHero: c.show_in_hero ?? false,
    isActive: c.is_active ?? true,
    seoTitle: c.seo_title ?? "",
    seoCanonicalUrl: c.seo_canonical_url ?? "",
    seoMetaDescription: c.seo_meta_description ?? "",
  };
}

// ─── formToPayload ─────────────────────────────────────────────────────────────

function formToPayload(form: FormState, status: "draft" | "registration_open") {
  return {
    title: form.title,
    slug: form.slug || undefined,
    short_description: form.shortDescription || null,
    description_html: form.descriptionHtml || null,
    outcomes_json: JSON.stringify(form.outcomes),
    language: form.language,
    content_rating: form.contentRating,
    search_tags: form.searchTags.join(",") || null,
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
    trailer_media_asset_id: form.trailerAssetId,
    substitute_media_asset_id: form.substituteAssetId,
    pre_roll_ad_id: form.preRollAdId,
    mid_roll_ad_id: form.midRollAdId,
    mid_roll_offset_seconds: form.midRollOffsetSeconds,
    is_cohort: form.isCohort,
    cohort_start_date: form.cohortStartDate || null,
    cert_config_json: JSON.stringify({
      enabled: form.cert.enabled,
      title: form.cert.title,
      hours: parseFloat(form.cert.hours) || null,
    }),
    expires_at: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    expiry_action: form.expiryAction || null,
    is_featured: form.isFeatured,
    show_in_hero: form.showInHero,
    is_active: form.isActive,
    publish_at: form.publishMode === "scheduled" && form.publishAt ? new Date(form.publishAt).toISOString() : null,
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
    resources: form.resources,
    modules: form.modules.map((mod, mIdx) => ({
      id: mod.id,
      title: mod.title || null,
      drip_days_after_enrolment: mod.drip_days_after_enrolment,
      display_order: mIdx,
      lessons: mod.lessons.map((l, lIdx) => ({
        id: l.id,
        title: l.title || null,
        lesson_type: l.lesson_type,
        media_asset_id: l.media_asset_id ?? null,
        body_html: l.body_html || null,
        is_preview: l.is_preview,
        display_order: lIdx,
      })),
    })),
  };
}

// ─── validate ─────────────────────────────────────────────────────────────────

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.title.trim()) errors.title = "Title is required.";
  if (form.accessLevel === "purchase" && form.priceMode === "fixed" && !form.priceNgn)
    errors.priceNgn = "Price is required for paid content.";
  if (form.accessLevel === "purchase" && form.priceMode === "pay_what_you_can") {
    const sug = parseFloat(form.suggestedPriceNgn);
    const min = parseFloat(form.minimumPriceNgn);
    if (min > sug) errors.minimumPriceNgn = "Minimum must be ≤ suggested price.";
  }
  return errors;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AddEditCourse() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const courseId = id ? Number(id) : undefined;
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
  const [publishErrors, setPublishErrors] = useState<string[]>([]);
  const savedFormRef = useRef<FormState | null>(null);

  // Unsaved-changes blocker
  useBlocker(({ currentLocation, nextLocation }) => {
    return isDirty && currentLocation.pathname !== nextLocation.pathname;
  });

  // Load existing course
  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    api<{ course: Record<string, any> }>(`/courses/${courseId}`)
      .then((res) => {
        const f = courseToForm(res.course);
        setForm(f);
        savedFormRef.current = f;
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err.message ?? "Failed to load course.");
        setLoading(false);
      });
  }, [courseId, isEdit]);

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
  }

  // Slug check
  async function checkSlug(slug: string) {
    if (!slug) { setSlugError(undefined); return; }
    try {
      const res = await api<{ available: boolean }>(
        `/courses/check-slug?slug=${encodeURIComponent(slug)}${courseId ? `&exclude_id=${courseId}` : ""}`,
      );
      setSlugError(res.available ? undefined : "This slug is already taken.");
    } catch { /* ignore */ }
  }

  // Save
  const doSave = useCallback(
    async (intentStatus: "draft" | "registration_open" = "draft", showToast = false) => {
      if (!form.title.trim()) return;
      setSaving(true);
      setAutosaveStatus("saving");
      try {
        const payload = formToPayload(form, intentStatus);
        const result = isEdit
          ? await api<{ course: Record<string, any> }>(`/courses/${courseId}`, { method: "PUT", body: JSON.stringify(payload) })
          : await api<{ course: Record<string, any> }>("/courses", { method: "POST", body: JSON.stringify(payload) });
        const updated = courseToForm(result.course);
        setForm(updated);
        savedFormRef.current = updated;
        setIsDirty(false);
        setAutosaveStatus("saved");
        if (showToast) toast("Course saved.", "success");
        if (!isEdit) {
          navigate(`/admin/courses/${result.course.id}/edit`, { replace: true });
        }
      } catch (err: any) {
        setAutosaveStatus("error");
        if (showToast) toast(err.message ?? "Save failed.", "error");
      } finally {
        setSaving(false);
        setTimeout(() => setAutosaveStatus("idle"), 3000);
      }
    },
    [form, isEdit, courseId, navigate, toast],
  );

  // Autosave every 30s when title non-empty
  useAutosave(
    async () => { if (!form.title.trim()) return; await doSave("draft", false); },
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
    // Client validation first
    const v = validate(form);
    if (Object.keys(v).length > 0) {
      setErrors(v);
      document.querySelector(`[data-field="${Object.keys(v)[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setErrors({});

    // Server publish validation (curriculum check)
    if (isEdit && courseId) {
      try {
        const result = await api<{ valid: boolean; failures: string[] }>(`/courses/${courseId}/validate-publish`, { method: "POST" });
        if (!result.valid) {
          setPublishErrors(result.failures);
          document.querySelector("[data-section='curriculum']")?.scrollIntoView({ behavior: "smooth", block: "center" });
          toast("Fix curriculum issues before publishing.", "error");
          return;
        }
      } catch { /* proceed anyway */ }
    }

    setPublishErrors([]);
    await doSave("registration_open", true);
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

  return (
    <div className="min-h-screen">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/90 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/admin/courses")}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            Courses
          </button>
          <span className="text-slate-700">/</span>
          <h1 className="text-sm font-semibold text-slate-100">
            {isEdit ? form.title || "Edit Course" : "New Course"}
          </h1>
          {form.status && <StatusBadge status={form.status} />}
        </div>
        <div className="flex items-center gap-3">
          <AutosaveIndicator status={autosaveStatus} />
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

          {/* ── Left column (58%) ── */}
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
                sessionId={courseId}
                speakerNames={speakerNames}
              />
            </div>

            <OutcomesPanel
              outcomes={form.outcomes}
              onChange={(outcomes) => patchForm({ outcomes })}
            />

            <SpeakersPanel
              speakers={form.speakers}
              onChange={(speakers) => patchForm({ speakers })}
            />

            <ClassificationPanel
              categoryIds={form.categoryIds}
              sessionFormat=""
              language={form.language}
              contentRating={form.contentRating}
              searchTags={form.searchTags}
              onCategoryIds={(ids) => patchForm({ categoryIds: ids })}
              onSessionFormat={() => {}}
              onLanguage={(v) => patchForm({ language: v })}
              onContentRating={(v) => patchForm({ contentRating: v })}
              onSearchTags={(tags) => patchForm({ searchTags: tags })}
            />

            <div data-section="curriculum">
              <CurriculumPanel
                modules={form.modules}
                onChange={(modules) => patchForm({ modules })}
                errors={publishErrors}
              />
            </div>

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

          {/* ── Right column (42%) ── */}
          <div className="flex flex-col gap-5 lg:flex-1">
            <CourseArtworkPanel
              masterImageUrl={form.masterImageUrl}
              focalX={form.focalX}
              focalY={form.focalY}
              imageOverrides={form.imageOverrides}
              trailerAssetId={form.trailerAssetId}
              trailerAsset={form.trailerAsset}
              substituteAssetId={form.substituteAssetId}
              substituteAsset={form.substituteAsset}
              onMasterImageUrl={(v) => patchForm({ masterImageUrl: v })}
              onFocalX={(v) => patchForm({ focalX: v })}
              onFocalY={(v) => patchForm({ focalY: v })}
              onImageOverrides={(v) => patchForm({ imageOverrides: v })}
              onTrailerAsset={(id, asset) => patchForm({ trailerAssetId: id, trailerAsset: asset })}
              onSubstituteAsset={(id, asset) => patchForm({ substituteAssetId: id, substituteAsset: asset })}
            />

            <DeliveryModePanel
              isCohort={form.isCohort}
              cohortStartDate={form.cohortStartDate}
              onIsCohort={(v) => patchForm({ isCohort: v })}
              onCohortStartDate={(v) => patchForm({ cohortStartDate: v })}
            />

            <CertificationPanel
              cert={form.cert}
              onChange={(cert) => patchForm({ cert })}
            />

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

            <FreshnessPanel
              expiresAt={form.expiresAt}
              expiryAction={form.expiryAction}
              onExpiresAt={(v) => patchForm({ expiresAt: v })}
              onExpiryAction={(v) => patchForm({ expiryAction: v })}
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
        status === "saving" ? "text-slate-500" : status === "saved" ? "text-emerald-400" : "text-red-400"
      }`}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Save failed"}
    </span>
  );
}
