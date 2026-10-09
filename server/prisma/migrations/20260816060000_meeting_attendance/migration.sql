-- Subscription revenue accrual (lib/earnings.ts computeSubscriptionAccrual)
-- reads watch time from playback_sessions — but a non-native meeting session
-- (Zoom/Teams/Google Meet/Jitsi) never creates one; Player.tsx redirects
-- straight to the real meeting instead of starting the native player, so
-- this app has no telemetry from what happens after the redirect. This
-- table is the honest substitute: one row per (user, content) redirect
-- event, converted into a policy-configured credited watch time by
-- computeSubscriptionAccrual — never pretending to have measured anything
-- real. See the model's own doc comment in schema.prisma for how this
-- differs from the pre-existing (registration-scoped, never-written-to)
-- Attendance table.

-- CreateTable
CREATE TABLE "meeting_attendances" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "content_id" INTEGER NOT NULL,
    "provider" "MeetingProvider" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_attendances_user_id_content_id_idx" ON "meeting_attendances"("user_id", "content_id");

-- CreateIndex
CREATE INDEX "meeting_attendances_content_id_idx" ON "meeting_attendances"("content_id");
