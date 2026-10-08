-- Site-wide promo banners — see Promotion model doc comment in schema.prisma.
CREATE TABLE "promotions" (
    "id" SERIAL NOT NULL,
    "headline" VARCHAR(200) NOT NULL,
    "body" VARCHAR(400),
    "link_url" VARCHAR(500),
    "link_label" VARCHAR(60),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "promotions_is_active_idx" ON "promotions"("is_active");
