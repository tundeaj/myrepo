-- Payouts admin.
--
-- earning_lines gets one new nullable column: payout_line_id. No @relation —
-- matching every cross-model reference in this schema — but without SOME
-- marker here, two payout runs created back to back would both aggregate the
-- same unclaimed earning line and pay the same instructor twice for it. A
-- draft run claims eligible lines by stamping this column with its own
-- PayoutLine's id; a cancelled draft run releases them by nulling it back out.

-- AlterTable
ALTER TABLE "earning_lines" ADD COLUMN     "payout_line_id" INTEGER;

-- CreateIndex
CREATE INDEX "earning_lines_payout_line_id_idx" ON "earning_lines"("payout_line_id");
