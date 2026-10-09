-- Simple static pages — see Page model doc comment in schema.prisma.
CREATE TABLE "pages" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "title_fr" VARCHAR(200),
    "slug" VARCHAR(160) NOT NULL,
    "body_html" TEXT NOT NULL,
    "body_html_fr" TEXT,
    "seo_title" VARCHAR(200),
    "seo_meta_description" VARCHAR(300),
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");
CREATE INDEX "pages_is_published_idx" ON "pages"("is_published");
