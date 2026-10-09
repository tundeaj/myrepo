-- Ratings comment moderation.
--
-- The `ratings.comment` column has existed since Prompt 01-C and has been
-- writable (routes/ratings.ts) since this build's own gap sweep — but
-- nothing has ever displayed a comment anywhere, because whether to show
-- one at all, and whether it needs review first, is a real product policy
-- decision this build never had an answer for. Rather than guess one,
-- that decision becomes an admin-configurable setting
-- (content_policy.rating_comments_mode — see settingsSchema.ts), and this
-- column is what lets the "review_required" mode actually mean something:
-- a comment sits 'pending' until an admin approves or rejects it.
--
-- Defaulting every existing (and future, in 'hidden' or 'auto_publish'
-- mode) row to 'pending' is harmless — the mode setting itself is what
-- decides whether comment_status is ever consulted at all.

-- CreateEnum
CREATE TYPE "RatingCommentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "ratings" ADD COLUMN     "comment_status" "RatingCommentStatus" NOT NULL DEFAULT 'pending';
