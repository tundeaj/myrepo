-- Stripe integration: PaymentProvider enum, Order.payment_provider /
-- stripe_session_id, and USD pricing fields alongside the existing NGN ones
-- on ContentItem and Plan. Hand-written the same way as
-- 20260816060000_meeting_attendance — `prisma migrate dev` fails in this
-- sandbox ("environment is non-interactive"); generated via
-- `prisma migrate diff --from-migrations ... --to-schema-datamodel ...`.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('paystack', 'stripe');

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "minimum_price_usd" DECIMAL(12,2),
ADD COLUMN     "price_usd" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "payment_provider" "PaymentProvider" NOT NULL DEFAULT 'paystack',
ADD COLUMN     "stripe_session_id" VARCHAR(200);

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "price_usd" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "orders_stripe_session_id_idx" ON "orders"("stripe_session_id");
