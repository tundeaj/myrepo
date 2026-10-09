-- One signed-in viewer's vote on one FAQ's helpfulness — see FaqVote's own
-- doc comment in schema.prisma for the full reasoning.
CREATE TABLE "faq_votes" (
    "id" SERIAL NOT NULL,
    "faq_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faq_votes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "faq_votes_faq_id_user_id_key" ON "faq_votes"("faq_id", "user_id");
