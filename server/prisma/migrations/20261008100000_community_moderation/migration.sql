-- CreateEnum
CREATE TYPE "CommunityPostStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "space_posts" ADD COLUMN "status" "CommunityPostStatus" NOT NULL DEFAULT 'pending';
CREATE INDEX "space_posts_status_idx" ON "space_posts"("status");

-- AlterTable
ALTER TABLE "post_comments" ADD COLUMN "status" "CommunityPostStatus" NOT NULL DEFAULT 'pending';
CREATE INDEX "post_comments_status_idx" ON "post_comments"("status");
