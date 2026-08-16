-- Third-party meeting platform integration (Zoom, Teams, Google Meet, Jitsi)
-- alongside this app's own native player. meeting_provider on content_items
-- picks the backend; the four meeting_* metadata columns are written ONLY by
-- lib/meetingProviders/ adapters after a real (or, for Jitsi, generated)
-- meeting exists — never typed in by an admin, same discipline as
-- playback_id. provider_connections stores the per-user OAuth grant each
-- adapter needs to act as that user (Zoom/Google/Microsoft); Jitsi needs none.
--
-- Defaulting meeting_provider to 'native' on every existing row is exactly
-- correct, not a placeholder: every session created before this migration
-- WAS native — there is no third-party meeting to backfill a join URL for.

-- CreateEnum
CREATE TYPE "MeetingProvider" AS ENUM ('native', 'zoom', 'teams', 'google_meet', 'jitsi');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('google', 'microsoft', 'zoom');

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "meeting_external_id" VARCHAR(255),
ADD COLUMN     "meeting_host_url" VARCHAR(500),
ADD COLUMN     "meeting_host_user_id" INTEGER,
ADD COLUMN     "meeting_join_url" VARCHAR(500),
ADD COLUMN     "meeting_provider" "MeetingProvider" NOT NULL DEFAULT 'native',
ADD COLUMN     "meeting_sync_error" VARCHAR(300),
ADD COLUMN     "meeting_synced_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "external_account_email" VARCHAR(190),
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_user_id_provider_key" ON "provider_connections"("user_id", "provider");
