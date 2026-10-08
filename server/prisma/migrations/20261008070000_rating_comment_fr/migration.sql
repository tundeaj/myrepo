-- Rating.comment_fr: an admin-authored French translation of a rating's
-- written comment, set from the moderation queue. Same shape as every
-- other _fr column in this schema.
ALTER TABLE "ratings" ADD COLUMN "comment_fr" TEXT;
