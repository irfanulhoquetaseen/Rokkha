-- AlterTable
ALTER TABLE "SoldOutEvent" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SoldOutEvent_idempotencyKey_key" ON "SoldOutEvent"("idempotencyKey");
