-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('viewer', 'instructor', 'admin', 'super_admin');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('owner', 'member', 'none');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('webinar', 'video', 'course');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'scheduled', 'pending_review', 'registration_open', 'starting_soon', 'live', 'ended', 'processing', 'replay_ready', 'archived');

-- CreateEnum
CREATE TYPE "SessionFormat" AS ENUM ('webinar', 'masterclass', 'panel', 'workshop', 'ama', 'lesson');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('public', 'registered', 'subscriber', 'purchase', 'cohort');

-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('fixed', 'pay_what_you_can', 'free', 'sponsored');

-- CreateEnum
CREATE TYPE "ExpiryAction" AS ENUM ('archive', 'flag_for_review', 'hide_from_browse');

-- CreateEnum
CREATE TYPE "ContentSpeakerRole" AS ENUM ('host', 'speaker', 'moderator', 'instructor', 'co-instructor', 'guest');

-- CreateEnum
CREATE TYPE "MediaAssetType" AS ENUM ('video', 'audio', 'trailer', 'substitute', 'document');

-- CreateEnum
CREATE TYPE "MediaSourceType" AS ENUM ('upload', 'hls_url', 'mp4_url', 'embed_url');

-- CreateEnum
CREATE TYPE "TranscodeStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ContentMediaRole" AS ENUM ('main', 'trailer', 'substitute', 'audio_only', 'resource');

-- CreateEnum
CREATE TYPE "LessonType" AS ENUM ('vod', 'live', 'text', 'quiz', 'assignment');

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('file', 'link', 'text');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('submitted', 'under_review', 'accepted', 'changes_requested');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('confirmed', 'waitlisted', 'cancelled');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'annual');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'cancelled', 'expired', 'paused');

-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('purchase', 'subscription', 'cohort', 'admin_grant');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('direct', 'corporate_invoice');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('percent', 'fixed');

-- CreateEnum
CREATE TYPE "CouponAppliesTo" AS ENUM ('all', 'content', 'plan');

-- CreateEnum
CREATE TYPE "InstructorApplicationStatus" AS ENUM ('pending', 'under_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('pending', 'approved', 'changes_requested', 'rejected');

-- CreateEnum
CREATE TYPE "AttributionBasis" AS ENUM ('direct_sale', 'subscription_watch_share', 'sponsorship');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('accruing', 'payable', 'paid', 'reversed');

-- CreateEnum
CREATE TYPE "PayoutRunStatus" AS ENUM ('draft', 'approved', 'processing', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "PayoutLineStatus" AS ENUM ('pending', 'approved', 'paid', 'failed');

-- CreateEnum
CREATE TYPE "StreamSessionStatus" AS ENUM ('starting', 'running', 'completed', 'failed_to_start', 'dropped', 'killed');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('desktop', 'mobile', 'tablet', 'tv');

-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ChapterType" AS ENUM ('intro', 'content', 'demo', 'qa', 'summary', 'housekeeping');

-- CreateEnum
CREATE TYPE "SubtitleSource" AS ENUM ('generated', 'translated', 'uploaded');

-- CreateEnum
CREATE TYPE "CommunitySpaceType" AS ENUM ('open', 'cohort', 'course');

-- CreateEnum
CREATE TYPE "SpaceMemberRole" AS ENUM ('member', 'moderator');

-- CreateEnum
CREATE TYPE "SponsorPlacement" AS ENUM ('session_page', 'player', 'hero', 'pre_session');

-- CreateEnum
CREATE TYPE "AdType" AS ENUM ('pre_roll', 'mid_roll');

-- CreateEnum
CREATE TYPE "PromoPlacement" AS ENUM ('home_top', 'home_mid', 'category', 'session_page', 'account');

-- CreateEnum
CREATE TYPE "PromoAudience" AS ENUM ('all', 'logged_out', 'free', 'subscriber', 'not_enrolled');

-- CreateEnum
CREATE TYPE "RestreamPlatform" AS ENUM ('youtube', 'facebook', 'x', 'linkedin');

-- CreateEnum
CREATE TYPE "BulkImportType" AS ENUM ('users', 'enrol', 'register');

-- CreateEnum
CREATE TYPE "BulkImportStatus" AS ENUM ('uploaded', 'validating', 'preview', 'processing', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('signup', 'checkout', 'reconsent', 'import');

-- CreateEnum
CREATE TYPE "SignupFieldType" AS ENUM ('text', 'email', 'phone', 'password', 'select', 'checkbox', 'image');

-- CreateEnum
CREATE TYPE "SignupFieldContext" AS ENUM ('public', 'checkout', 'corporate_seat', 'instructor');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'in_app', 'whatsapp');

-- CreateEnum
CREATE TYPE "CalendarProvider" AS ENUM ('google', 'outlook', 'ical');

-- CreateEnum
CREATE TYPE "RowType" AS ENUM ('live_now', 'starting_soon', 'my_upcoming', 'this_week', 'just_added', 'continue_watching', 'continue_learning', 'almost_done', 'missed_live', 'my_courses', 'in_my_plan', 'free_this_week', 'upgrade_teaser', 'top_ten', 'popular_in_industry', 'category_tiles', 'similar_to_watched', 'under_30_min', 'audio_available', 'highest_rated', 'most_attended', 'featured_speakers', 'by_speaker', 'new_instructors');

-- CreateEnum
CREATE TYPE "RowSurface" AS ENUM ('home', 'live', 'courses', 'category', 'speaker', 'landing');

-- CreateEnum
CREATE TYPE "RowPlatform" AS ENUM ('web', 'mobile', 'all');

-- CreateEnum
CREATE TYPE "RowAudience" AS ENUM ('all', 'logged_out', 'registered', 'subscriber', 'enrolled');

-- CreateEnum
CREATE TYPE "CardStyle" AS ENUM ('poster', 'landscape', 'numbered', 'tile', 'speaker');

-- CreateEnum
CREATE TYPE "RowConditionType" AS ENUM ('live_exists', 'session_within_hours', 'course_progress_gte', 'incomplete_progress', 'unwatched_replay', 'inactive_days', 'logged_out', 'never_purchased');

-- CreateEnum
CREATE TYPE "CmsPageStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "FaqScope" AS ENUM ('global', 'content');

-- CreateEnum
CREATE TYPE "EnquiryType" AS ENUM ('general', 'corporate_training', 'speaking', 'partnership', 'support');

-- CreateEnum
CREATE TYPE "ContactRequestStatus" AS ENUM ('new', 'in_progress', 'quoted', 'won', 'lost', 'closed');

-- CreateEnum
CREATE TYPE "ModuleTier" AS ENUM ('core', 'growth', 'enterprise');

-- CreateEnum
CREATE TYPE "SetupStepCategory" AS ENUM ('platform', 'instructor');

-- CreateEnum
CREATE TYPE "SetupStepStatus" AS ENUM ('pending', 'in_progress', 'complete', 'skipped');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(190) NOT NULL,
    "password_hash" VARCHAR(255),
    "full_name" VARCHAR(150),
    "avatar_url" VARCHAR(500),
    "role" "UserRole" NOT NULL DEFAULT 'viewer',
    "country" VARCHAR(2) NOT NULL DEFAULT 'NG',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Lagos',
    "preferred_language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "industry" VARCHAR(80),
    "job_role" VARCHAR(80),
    "company_name" VARCHAR(150),
    "headline" VARCHAR(200),
    "bio" TEXT,
    "parent_account_id" INTEGER,
    "seat_status" "SeatStatus" NOT NULL DEFAULT 'none',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" SERIAL NOT NULL,
    "content_type" "ContentType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "title_fr" VARCHAR(200),
    "slug" VARCHAR(220) NOT NULL,
    "short_description" VARCHAR(250),
    "short_description_fr" VARCHAR(250),
    "description_html" TEXT,
    "description_html_fr" TEXT,
    "master_image_url" VARCHAR(500),
    "focal_x" INTEGER NOT NULL DEFAULT 50,
    "focal_y" INTEGER NOT NULL DEFAULT 50,
    "image_overrides" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "scheduled_start_at" TIMESTAMP(3),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Lagos',
    "scheduled_duration_minutes" INTEGER,
    "registration_closes_at" TIMESTAMP(3),
    "capacity" INTEGER,
    "session_format" "SessionFormat",
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "content_rating" VARCHAR(20) NOT NULL DEFAULT 'general',
    "access_level" "AccessLevel" NOT NULL DEFAULT 'registered',
    "price_mode" "PriceMode" NOT NULL DEFAULT 'fixed',
    "price_ngn" DECIMAL(12,2),
    "suggested_price_ngn" DECIMAL(12,2),
    "minimum_price_ngn" DECIMAL(12,2),
    "compare_at_price_ngn" DECIMAL(12,2),
    "free_preview_seconds" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "expiry_action" "ExpiryAction",
    "stream_provider" VARCHAR(50),
    "stream_key" VARCHAR(255),
    "playback_id" VARCHAR(255),
    "is_cohort" BOOLEAN NOT NULL DEFAULT false,
    "cohort_start_date" DATE,
    "restream_enabled" BOOLEAN NOT NULL DEFAULT false,
    "restream_cutoff_minutes" INTEGER,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "show_in_hero" BOOLEAN NOT NULL DEFAULT false,
    "has_transcript" BOOLEAN NOT NULL DEFAULT false,
    "has_chapters" BOOLEAN NOT NULL DEFAULT false,
    "has_substitute" BOOLEAN NOT NULL DEFAULT false,
    "watermark_enabled" BOOLEAN NOT NULL DEFAULT false,
    "avg_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "registration_count" INTEGER NOT NULL DEFAULT 0,
    "search_tags" VARCHAR(500),
    "seo_title" VARCHAR(200),
    "seo_meta_description" VARCHAR(300),
    "seo_canonical_url" VARCHAR(300),
    "pre_roll_ad_id" INTEGER,
    "mid_roll_ad_id" INTEGER,
    "mid_roll_offset_seconds" INTEGER,
    "publish_at" TIMESTAMP(3),
    "content_last_updated_at" TIMESTAMP(3),
    "last_reviewed_by" INTEGER,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_fr" VARCHAR(100),
    "slug" VARCHAR(120),
    "description" VARCHAR(300),
    "description_fr" VARCHAR(300),
    "image_url" VARCHAR(500),
    "show_as_tile" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_categories" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "content_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaker_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_fr" VARCHAR(100),
    "slug" VARCHAR(120),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "speaker_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speakers" (
    "id" SERIAL NOT NULL,
    "full_name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(170) NOT NULL,
    "email" VARCHAR(190),
    "phone" VARCHAR(30),
    "title" VARCHAR(150),
    "organisation" VARCHAR(150),
    "bio" TEXT,
    "bio_fr" TEXT,
    "master_image_url" VARCHAR(500),
    "focal_x" INTEGER NOT NULL DEFAULT 50,
    "focal_y" INTEGER NOT NULL DEFAULT 50,
    "linkedin_url" VARCHAR(300),
    "speaker_type_id" INTEGER,
    "user_id" INTEGER,
    "bank_code" VARCHAR(10),
    "bank_name" VARCHAR(120),
    "account_number" VARCHAR(10),
    "account_name_resolved" VARCHAR(150),
    "paystack_recipient_code" VARCHAR(120),
    "payout_verified" BOOLEAN NOT NULL DEFAULT false,
    "commission_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "speakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_speakers" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "speaker_id" INTEGER NOT NULL,
    "role" "ContentSpeakerRole" NOT NULL DEFAULT 'speaker',
    "revenue_share_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "content_speakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200),
    "asset_type" "MediaAssetType" NOT NULL,
    "source_type" "MediaSourceType" NOT NULL DEFAULT 'upload',
    "provider" VARCHAR(50),
    "provider_asset_id" VARCHAR(255),
    "hls_url" VARCHAR(500),
    "mp4_url" VARCHAR(500),
    "embed_url" VARCHAR(500),
    "thumbnail_url" VARCHAR(500),
    "duration_seconds" INTEGER,
    "file_size_mb" INTEGER,
    "resolution" VARCHAR(20),
    "transcode_status" "TranscodeStatus" NOT NULL DEFAULT 'pending',
    "is_protected" BOOLEAN NOT NULL DEFAULT true,
    "storage_zone" VARCHAR(100),
    "tags" VARCHAR(500),
    "uploaded_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_media" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER,
    "lesson_id" INTEGER,
    "media_asset_id" INTEGER NOT NULL,
    "role" "ContentMediaRole" NOT NULL DEFAULT 'main',
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "content_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_variants" (
    "id" SERIAL NOT NULL,
    "variant_key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "aspect_ratio" VARCHAR(10) NOT NULL,
    "imagekit_transform" VARCHAR(200) NOT NULL,
    "usage_note" VARCHAR(200),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "image_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" SERIAL NOT NULL,
    "course_id" INTEGER NOT NULL,
    "title" VARCHAR(200),
    "title_fr" VARCHAR(200),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "drip_days_after_enrolment" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_lessons" (
    "id" SERIAL NOT NULL,
    "module_id" INTEGER NOT NULL,
    "title" VARCHAR(200),
    "title_fr" VARCHAR(200),
    "lesson_type" "LessonType" NOT NULL DEFAULT 'vod',
    "vod_playback_url" VARCHAR(500),
    "duration_seconds" INTEGER,
    "body_html" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_preview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "watch_seconds" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" SERIAL NOT NULL,
    "lesson_id" INTEGER NOT NULL,
    "instructions_html" TEXT,
    "submission_type" "SubmissionType",
    "max_file_mb" INTEGER NOT NULL DEFAULT 25,
    "due_days_after_unlock" INTEGER NOT NULL DEFAULT 7,
    "is_peer_visible" BOOLEAN NOT NULL DEFAULT false,
    "passing_score" INTEGER,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" SERIAL NOT NULL,
    "assignment_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_url" VARCHAR(500),
    "link_url" VARCHAR(300),
    "text_body" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'submitted',
    "score" INTEGER,
    "feedback" TEXT,
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'confirmed',
    "join_token" VARCHAR(64) NOT NULL,
    "custom_answers" TEXT,
    "reminder_24h_sent" BOOLEAN NOT NULL DEFAULT false,
    "reminder_1h_sent" BOOLEAN NOT NULL DEFAULT false,
    "reminder_10m_sent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" SERIAL NOT NULL,
    "registration_id" INTEGER NOT NULL,
    "joined_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "watch_seconds" INTEGER NOT NULL DEFAULT 0,
    "attended" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_questions" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "question" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "is_answered" BOOLEAN NOT NULL DEFAULT false,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_config" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "chat_enabled" BOOLEAN NOT NULL DEFAULT true,
    "qa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "polls_enabled" BOOLEAN NOT NULL DEFAULT false,
    "chat_moderated" BOOLEAN NOT NULL DEFAULT true,
    "allow_anonymous_qa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "session_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100),
    "price_ngn" DECIMAL(12,2),
    "billing_interval" "BillingInterval" NOT NULL DEFAULT 'monthly',
    "features" TEXT,
    "max_concurrent_streams" INTEGER NOT NULL DEFAULT 1,
    "seat_count" INTEGER NOT NULL DEFAULT 1,
    "is_team_plan" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "plan_id" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "current_period_end" TIMESTAMP(3),
    "paused_until" TIMESTAMP(3),
    "paystack_subscription_code" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlements" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "source" "EntitlementSource" NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_id" INTEGER,
    "plan_id" INTEGER,
    "amount_ngn" DECIMAL(12,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "order_type" "OrderType" NOT NULL DEFAULT 'direct',
    "invoice_requested" BOOLEAN NOT NULL DEFAULT false,
    "invoice_url" VARCHAR(500),
    "invoice_number" VARCHAR(40),
    "invoice_due_date" DATE,
    "coupon_id" INTEGER,
    "paystack_reference" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "discount_type" "CouponDiscountType",
    "discount_value" DECIMAL(10,2),
    "applies_to" "CouponAppliesTo",
    "target_id" INTEGER,
    "max_redemptions" INTEGER,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "min_order_ngn" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" INTEGER,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_applications" (
    "id" SERIAL NOT NULL,
    "full_name" VARCHAR(150),
    "email" VARCHAR(190),
    "phone" VARCHAR(30),
    "expertise_areas" VARCHAR(300),
    "proposed_topics" TEXT,
    "linkedin_url" VARCHAR(300),
    "sample_video_url" VARCHAR(500),
    "audience_size" VARCHAR(60),
    "status" "InstructorApplicationStatus" NOT NULL DEFAULT 'pending',
    "reviewer_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instructor_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_queue" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER,
    "submitted_by" INTEGER,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewer_id" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "decision" "ReviewDecision" NOT NULL DEFAULT 'pending',
    "notes" TEXT,

    CONSTRAINT "review_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earning_lines" (
    "id" SERIAL NOT NULL,
    "speaker_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "order_id" INTEGER,
    "subscription_id" INTEGER,
    "period_month" VARCHAR(7),
    "gross_ngn" DECIMAL(14,2),
    "share_pct" DECIMAL(5,2),
    "earned_ngn" DECIMAL(14,2),
    "attribution_basis" "AttributionBasis",
    "watch_hours" DECIMAL(10,2),
    "holdback_until" TIMESTAMP(3),
    "status" "EarningStatus" NOT NULL DEFAULT 'accruing',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earning_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_runs" (
    "id" SERIAL NOT NULL,
    "period_month" VARCHAR(7),
    "status" "PayoutRunStatus" NOT NULL DEFAULT 'draft',
    "total_gross_ngn" DECIMAL(14,2),
    "total_wht_ngn" DECIMAL(14,2),
    "total_net_ngn" DECIMAL(14,2),
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payout_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_lines" (
    "id" SERIAL NOT NULL,
    "payout_run_id" INTEGER NOT NULL,
    "speaker_id" INTEGER NOT NULL,
    "gross_ngn" DECIMAL(14,2),
    "commission_ngn" DECIMAL(14,2),
    "wht_applicable" BOOLEAN NOT NULL DEFAULT false,
    "wht_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wht_amount_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_ngn" DECIMAL(14,2),
    "payment_reference" VARCHAR(120),
    "status" "PayoutLineStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "failure_reason" VARCHAR(300),
    "statement_url" VARCHAR(500),

    CONSTRAINT "payout_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_sessions" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER,
    "stream_key_used" VARCHAR(255),
    "status" "StreamSessionStatus",
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "peak_viewers" INTEGER NOT NULL DEFAULT 0,
    "peak_at" TIMESTAMP(3),
    "avg_viewers" INTEGER NOT NULL DEFAULT 0,
    "reconnect_count" INTEGER NOT NULL DEFAULT 0,
    "avg_bitrate_kbps" INTEGER,
    "dropped_frames" INTEGER,
    "failure_reason" VARCHAR(300),
    "incident_notified_at" TIMESTAMP(3),

    CONSTRAINT "stream_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_health_samples" (
    "id" SERIAL NOT NULL,
    "stream_session_id" INTEGER NOT NULL,
    "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bitrate_kbps" INTEGER,
    "framerate" INTEGER,
    "dropped_frames" INTEGER,
    "concurrent_viewers" INTEGER,

    CONSTRAINT "stream_health_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playback_sessions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "content_id" INTEGER,
    "lesson_id" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "watch_seconds" INTEGER NOT NULL DEFAULT 0,
    "completion_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "device_type" "DeviceType",
    "os" VARCHAR(60),
    "browser" VARCHAR(60),
    "country" VARCHAR(2),
    "region" VARCHAR(80),
    "network_type" VARCHAR(20),
    "avg_bitrate_kbps" INTEGER,
    "load_time_ms" INTEGER,
    "buffering_events" INTEGER NOT NULL DEFAULT 0,
    "buffering_seconds" INTEGER NOT NULL DEFAULT 0,
    "quality_changes" INTEGER NOT NULL DEFAULT 0,
    "error_code" VARCHAR(60),
    "playback_speed" DECIMAL(3,2) NOT NULL DEFAULT 1.0,

    CONSTRAINT "playback_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_daily" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "storage_gb" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "bandwidth_gb" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "transcode_minutes" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fx_rate_ngn" DECIMAL(12,2),
    "cost_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_usage" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "period_month" VARCHAR(7) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "watch_hours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bandwidth_gb" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "estimated_cost_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revenue_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "margin_ngn" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "content_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER,
    "media_asset_id" INTEGER,
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "full_text" TEXT,
    "word_count" INTEGER,
    "status" "TranscriptStatus" NOT NULL DEFAULT 'pending',
    "provider" VARCHAR(50),
    "generated_at" TIMESTAMP(3),
    "edited_by" INTEGER,
    "edited_at" TIMESTAMP(3),

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" SERIAL NOT NULL,
    "transcript_id" INTEGER NOT NULL,
    "start_seconds" DECIMAL(10,2),
    "end_seconds" DECIMAL(10,2),
    "speaker_label" VARCHAR(80),
    "text" TEXT,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "title" VARCHAR(200),
    "title_fr" VARCHAR(200),
    "start_seconds" INTEGER,
    "chapter_type" "ChapterType",
    "is_skippable" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER,
    "auto_generated" BOOLEAN NOT NULL DEFAULT true,
    "edited_by" INTEGER,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subtitle_tracks" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER,
    "media_asset_id" INTEGER,
    "language" VARCHAR(10),
    "label" VARCHAR(60),
    "vtt_url" VARCHAR(500),
    "source" "SubtitleSource",
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_reviewed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "subtitle_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_spaces" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150),
    "slug" VARCHAR(170) NOT NULL,
    "description" TEXT,
    "space_type" "CommunitySpaceType" NOT NULL DEFAULT 'open',
    "linked_content_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_members" (
    "id" SERIAL NOT NULL,
    "space_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "SpaceMemberRole" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_posts" (
    "id" SERIAL NOT NULL,
    "space_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "body" TEXT,
    "attachment_url" VARCHAR(500),
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_comments" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "body" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ratings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verification_code" VARCHAR(40) NOT NULL,
    "pdf_url" VARCHAR(500),

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER,
    "lesson_id" INTEGER,
    "title" VARCHAR(200),
    "file_url" VARCHAR(500),
    "file_type" VARCHAR(20),
    "file_size_kb" INTEGER,
    "requires_entitlement" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsors" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150),
    "logo_url" VARCHAR(500),
    "website_url" VARCHAR(300),
    "contact_email" VARCHAR(190),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_sponsors" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "sponsor_id" INTEGER NOT NULL,
    "sponsorship_ngn" DECIMAL(12,2),
    "placement" "SponsorPlacement",
    "message" VARCHAR(300),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),

    CONSTRAINT "content_sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ads" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150),
    "ad_type" "AdType",
    "video_url" VARCHAR(500),
    "click_url" VARCHAR(500),
    "duration_seconds" INTEGER,
    "advertiser_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisers" (
    "id" SERIAL NOT NULL,
    "company_name" VARCHAR(150) NOT NULL,
    "contact_name" VARCHAR(150),
    "contact_email" VARCHAR(190),
    "contact_phone" VARCHAR(30),
    "website_url" VARCHAR(300),
    "logo_url" VARCHAR(500),
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_banners" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200),
    "body" VARCHAR(500),
    "image_url" VARCHAR(500),
    "cta_label" VARCHAR(80),
    "cta_url" VARCHAR(300),
    "placement" "PromoPlacement",
    "audience" "PromoAudience",
    "target_content_id" INTEGER,
    "country" VARCHAR(2),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "promo_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restream_targets" (
    "id" SERIAL NOT NULL,
    "content_id" INTEGER NOT NULL,
    "platform" "RestreamPlatform" NOT NULL,
    "rtmp_url" VARCHAR(500),
    "stream_key" VARCHAR(255),
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "restream_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_imports" (
    "id" SERIAL NOT NULL,
    "import_type" "BulkImportType" NOT NULL,
    "target_content_id" INTEGER,
    "file_url" VARCHAR(500),
    "total_rows" INTEGER,
    "succeeded" INTEGER,
    "updated" INTEGER,
    "skipped" INTEGER,
    "failed" INTEGER,
    "status" "BulkImportStatus" NOT NULL DEFAULT 'uploaded',
    "error_report_url" VARCHAR(500),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" SERIAL NOT NULL,
    "policy_key" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200),
    "title_fr" VARCHAR(200),
    "body_html" TEXT,
    "body_html_fr" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" TIMESTAMP(3),
    "requires_reconsent" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "policy_key" VARCHAR(60),
    "policy_version" INTEGER,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(300),
    "consent_method" "ConsentMethod",

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signup_fields" (
    "id" SERIAL NOT NULL,
    "field_key" VARCHAR(60),
    "label" VARCHAR(100),
    "label_fr" VARCHAR(100),
    "field_type" "SignupFieldType",
    "context" "SignupFieldContext",
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "options" TEXT,
    "help_text" VARCHAR(200),

    CONSTRAINT "signup_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" VARCHAR(50),
    "title" VARCHAR(200),
    "body" TEXT,
    "link_url" VARCHAR(500),
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "event_key" VARCHAR(60) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "timezone" VARCHAR(64),
    "language" VARCHAR(10),
    "subtitle_language" VARCHAR(10),
    "default_quality" VARCHAR(10),
    "data_saver" BOOLEAN NOT NULL DEFAULT false,
    "default_playback_speed" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "subtitles_on" BOOLEAN NOT NULL DEFAULT true,
    "autoplay_next" BOOLEAN NOT NULL DEFAULT true,
    "reminder_offsets" VARCHAR(60) NOT NULL DEFAULT '1440,60,10',
    "calendar_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "calendar_provider" "CalendarProvider",
    "quiet_hours_start" TIME,
    "quiet_hours_end" TIME,
    "weekly_digest" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "device_fingerprint" VARCHAR(120),
    "device_name" VARCHAR(100),
    "device_type" VARCHAR(20),
    "os" VARCHAR(60),
    "browser" VARCHAR(60),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_ip" VARCHAR(45),
    "last_country" VARCHAR(2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "provider" "CalendarProvider" NOT NULL,
    "provider_event_id" VARCHAR(200),
    "ics_token" VARCHAR(64) NOT NULL,
    "synced_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_rows" (
    "id" SERIAL NOT NULL,
    "row_key" VARCHAR(60),
    "label" VARCHAR(120),
    "label_fr" VARCHAR(120),
    "row_type" "RowType" NOT NULL,
    "surface" "RowSurface",
    "platform" "RowPlatform" NOT NULL DEFAULT 'all',
    "audience" "RowAudience" NOT NULL DEFAULT 'all',
    "params" TEXT,
    "card_limit" INTEGER NOT NULL DEFAULT 15,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "hide_when_empty" BOOLEAN NOT NULL DEFAULT true,
    "card_style" "CardStyle" NOT NULL DEFAULT 'poster',

    CONSTRAINT "content_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "row_rules" (
    "id" SERIAL NOT NULL,
    "rule_key" VARCHAR(60),
    "description" VARCHAR(200) NOT NULL,
    "condition_type" "RowConditionType",
    "condition_value" INTEGER,
    "promote_row_key" VARCHAR(60),
    "priority" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "row_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_cache" (
    "id" SERIAL NOT NULL,
    "cache_key" VARCHAR(120) NOT NULL,
    "payload" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "row_count" INTEGER,
    "item_count" INTEGER,

    CONSTRAINT "homepage_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_pages" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200),
    "title_fr" VARCHAR(200),
    "body_html" TEXT,
    "body_html_fr" TEXT,
    "status" "CmsPageStatus" NOT NULL DEFAULT 'draft',
    "seo_title" VARCHAR(200),
    "seo_meta_description" VARCHAR(300),
    "is_system_page" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landing_pages" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(200),
    "hero_headline" VARCHAR(300),
    "hero_subheadline" VARCHAR(400),
    "hero_image_url" VARCHAR(500),
    "sections" TEXT,
    "cta_label" VARCHAR(80),
    "cta_url" VARCHAR(300),
    "target_content_id" INTEGER,
    "is_front_page" BOOLEAN NOT NULL DEFAULT false,
    "utm_source" VARCHAR(80),
    "utm_medium" VARCHAR(80),
    "utm_campaign" VARCHAR(80),
    "status" "LandingPageStatus" NOT NULL DEFAULT 'draft',
    "views" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" SERIAL NOT NULL,
    "question" VARCHAR(300),
    "question_fr" VARCHAR(300),
    "answer_html" TEXT,
    "answer_html_fr" TEXT,
    "scope" "FaqScope",
    "content_id" INTEGER,
    "category" VARCHAR(60),
    "display_order" INTEGER,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "helpful_yes" INTEGER NOT NULL DEFAULT 0,
    "helpful_no" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150),
    "email" VARCHAR(190),
    "phone" VARCHAR(30),
    "company" VARCHAR(150),
    "enquiry_type" "EnquiryType",
    "message" TEXT,
    "source_page" VARCHAR(200),
    "status" "ContactRequestStatus" NOT NULL DEFAULT 'new',
    "assigned_to" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" SERIAL NOT NULL,
    "setting_key" VARCHAR(100) NOT NULL,
    "setting_value" TEXT,
    "setting_group" VARCHAR(50),
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" INTEGER,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modules" (
    "flag_key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120),
    "description" VARCHAR(300),
    "tier" "ModuleTier" NOT NULL DEFAULT 'core',
    "depends_on" VARCHAR(300),
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" INTEGER,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("flag_key")
);

-- CreateTable
CREATE TABLE "setup_steps" (
    "id" SERIAL NOT NULL,
    "step_key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(150),
    "description" VARCHAR(300),
    "category" "SetupStepCategory" NOT NULL DEFAULT 'platform',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "SetupStepStatus" NOT NULL DEFAULT 'pending',
    "completed_at" TIMESTAMP(3),
    "completed_by" INTEGER,
    "config_route" VARCHAR(200),

    CONSTRAINT "setup_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ui_translations" (
    "id" SERIAL NOT NULL,
    "translation_key" VARCHAR(120) NOT NULL,
    "en" TEXT,
    "fr" TEXT,
    "context" VARCHAR(200),
    "is_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ui_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "footer_links" (
    "id" SERIAL NOT NULL,
    "label" VARCHAR(100),
    "label_fr" VARCHAR(100),
    "url" VARCHAR(300),
    "column_group" VARCHAR(50),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "opens_new_tab" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_required" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "footer_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_parent_account_id_idx" ON "users"("parent_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_slug_key" ON "content_items"("slug");

-- CreateIndex
CREATE INDEX "content_items_status_idx" ON "content_items"("status");

-- CreateIndex
CREATE INDEX "content_items_scheduled_start_at_idx" ON "content_items"("scheduled_start_at");

-- CreateIndex
CREATE INDEX "content_items_content_type_idx" ON "content_items"("content_type");

-- CreateIndex
CREATE INDEX "content_items_access_level_idx" ON "content_items"("access_level");

-- CreateIndex
CREATE INDEX "content_items_is_featured_idx" ON "content_items"("is_featured");

-- CreateIndex
CREATE INDEX "content_items_is_active_idx" ON "content_items"("is_active");

-- CreateIndex
CREATE INDEX "content_items_status_scheduled_start_at_idx" ON "content_items"("status", "scheduled_start_at");

-- CreateIndex
CREATE INDEX "content_items_content_type_status_idx" ON "content_items"("content_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "content_categories_content_id_idx" ON "content_categories"("content_id");

-- CreateIndex
CREATE INDEX "content_categories_category_id_idx" ON "content_categories"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_categories_content_id_category_id_key" ON "content_categories"("content_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "speakers_slug_key" ON "speakers"("slug");

-- CreateIndex
CREATE INDEX "speakers_user_id_idx" ON "speakers"("user_id");

-- CreateIndex
CREATE INDEX "speakers_speaker_type_id_idx" ON "speakers"("speaker_type_id");

-- CreateIndex
CREATE INDEX "content_speakers_content_id_idx" ON "content_speakers"("content_id");

-- CreateIndex
CREATE INDEX "content_speakers_speaker_id_idx" ON "content_speakers"("speaker_id");

-- CreateIndex
CREATE INDEX "media_assets_asset_type_idx" ON "media_assets"("asset_type");

-- CreateIndex
CREATE INDEX "media_assets_transcode_status_idx" ON "media_assets"("transcode_status");

-- CreateIndex
CREATE INDEX "media_assets_uploaded_by_idx" ON "media_assets"("uploaded_by");

-- CreateIndex
CREATE INDEX "media_assets_is_protected_idx" ON "media_assets"("is_protected");

-- CreateIndex
CREATE INDEX "content_media_content_id_idx" ON "content_media"("content_id");

-- CreateIndex
CREATE INDEX "content_media_lesson_id_idx" ON "content_media"("lesson_id");

-- CreateIndex
CREATE INDEX "content_media_media_asset_id_idx" ON "content_media"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "image_variants_variant_key_key" ON "image_variants"("variant_key");

-- CreateIndex
CREATE INDEX "course_modules_course_id_idx" ON "course_modules"("course_id");

-- CreateIndex
CREATE INDEX "course_lessons_module_id_idx" ON "course_lessons"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_user_id_lesson_id_key" ON "lesson_progress"("user_id", "lesson_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_user_id_key" ON "assignment_submissions"("assignment_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_join_token_key" ON "registrations"("join_token");

-- CreateIndex
CREATE INDEX "registrations_content_id_idx" ON "registrations"("content_id");

-- CreateIndex
CREATE INDEX "registrations_status_idx" ON "registrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_user_id_content_id_key" ON "registrations"("user_id", "content_id");

-- CreateIndex
CREATE INDEX "attendance_registration_id_idx" ON "attendance"("registration_id");

-- CreateIndex
CREATE INDEX "qa_questions_content_id_idx" ON "qa_questions"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_config_content_id_key" ON "session_config"("content_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "entitlements_user_id_idx" ON "entitlements"("user_id");

-- CreateIndex
CREATE INDEX "entitlements_content_id_idx" ON "entitlements"("content_id");

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_paystack_reference_idx" ON "orders"("paystack_reference");

-- CreateIndex
CREATE INDEX "orders_order_type_idx" ON "orders"("order_type");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "earning_lines_speaker_id_idx" ON "earning_lines"("speaker_id");

-- CreateIndex
CREATE INDEX "earning_lines_period_month_idx" ON "earning_lines"("period_month");

-- CreateIndex
CREATE INDEX "earning_lines_status_idx" ON "earning_lines"("status");

-- CreateIndex
CREATE INDEX "payout_lines_payout_run_id_idx" ON "payout_lines"("payout_run_id");

-- CreateIndex
CREATE INDEX "payout_lines_speaker_id_idx" ON "payout_lines"("speaker_id");

-- CreateIndex
CREATE INDEX "payout_lines_status_idx" ON "payout_lines"("status");

-- CreateIndex
CREATE INDEX "stream_sessions_content_id_idx" ON "stream_sessions"("content_id");

-- CreateIndex
CREATE INDEX "stream_sessions_status_idx" ON "stream_sessions"("status");

-- CreateIndex
CREATE INDEX "stream_sessions_started_at_idx" ON "stream_sessions"("started_at");

-- CreateIndex
CREATE INDEX "stream_health_samples_stream_session_id_sampled_at_idx" ON "stream_health_samples"("stream_session_id", "sampled_at");

-- CreateIndex
CREATE INDEX "playback_sessions_content_id_idx" ON "playback_sessions"("content_id");

-- CreateIndex
CREATE INDEX "playback_sessions_user_id_idx" ON "playback_sessions"("user_id");

-- CreateIndex
CREATE INDEX "playback_sessions_started_at_idx" ON "playback_sessions"("started_at");

-- CreateIndex
CREATE INDEX "playback_sessions_region_idx" ON "playback_sessions"("region");

-- CreateIndex
CREATE INDEX "playback_sessions_device_type_idx" ON "playback_sessions"("device_type");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_date_key" ON "usage_daily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "content_usage_content_id_period_month_key" ON "content_usage"("content_id", "period_month");

-- CreateIndex
CREATE INDEX "transcript_segments_transcript_id_start_seconds_idx" ON "transcript_segments"("transcript_id", "start_seconds");

-- CreateIndex
CREATE INDEX "chapters_content_id_start_seconds_idx" ON "chapters"("content_id", "start_seconds");

-- CreateIndex
CREATE INDEX "subtitle_tracks_content_id_idx" ON "subtitle_tracks"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_spaces_slug_key" ON "community_spaces"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "space_members_space_id_user_id_key" ON "space_members"("space_id", "user_id");

-- CreateIndex
CREATE INDEX "space_posts_space_id_created_at_idx" ON "space_posts"("space_id", "created_at");

-- CreateIndex
CREATE INDEX "post_comments_post_id_idx" ON "post_comments"("post_id");

-- CreateIndex
CREATE INDEX "ratings_content_id_idx" ON "ratings"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_user_id_content_id_key" ON "ratings"("user_id", "content_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_verification_code_key" ON "certificates"("verification_code");

-- CreateIndex
CREATE INDEX "certificates_user_id_idx" ON "certificates"("user_id");

-- CreateIndex
CREATE INDEX "certificates_verification_code_idx" ON "certificates"("verification_code");

-- CreateIndex
CREATE INDEX "resources_content_id_idx" ON "resources"("content_id");

-- CreateIndex
CREATE INDEX "resources_lesson_id_idx" ON "resources"("lesson_id");

-- CreateIndex
CREATE INDEX "restream_targets_content_id_idx" ON "restream_targets"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX "policies_policy_key_version_key" ON "policies"("policy_key", "version");

-- CreateIndex
CREATE INDEX "consent_records_user_id_policy_key_idx" ON "consent_records"("user_id", "policy_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_event_key_channel_key" ON "notification_preferences"("user_id", "event_key", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_device_fingerprint_key" ON "user_devices"("user_id", "device_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_ics_token_key" ON "calendar_events"("ics_token");

-- CreateIndex
CREATE INDEX "calendar_events_ics_token_idx" ON "calendar_events"("ics_token");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_user_id_content_id_provider_key" ON "calendar_events"("user_id", "content_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_cache_cache_key_key" ON "homepage_cache"("cache_key");

-- CreateIndex
CREATE INDEX "homepage_cache_cache_key_idx" ON "homepage_cache"("cache_key");

-- CreateIndex
CREATE INDEX "homepage_cache_expires_at_idx" ON "homepage_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cms_pages_slug_key" ON "cms_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "landing_pages_slug_key" ON "landing_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "settings_setting_key_key" ON "settings"("setting_key");

-- CreateIndex
CREATE INDEX "settings_setting_group_idx" ON "settings"("setting_group");

-- CreateIndex
CREATE UNIQUE INDEX "setup_steps_step_key_key" ON "setup_steps"("step_key");

-- CreateIndex
CREATE UNIQUE INDEX "ui_translations_translation_key_key" ON "ui_translations"("translation_key");
