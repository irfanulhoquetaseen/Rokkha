-- Staff queue (hospital + status, sorted by expiry / creation) and "my reservations" (newest first).
-- CreateIndex
CREATE INDEX "Reservation_hospitalId_status_expiresAt_idx" ON "Reservation"("hospitalId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_hospitalId_createdAt_idx" ON "Reservation"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "Reservation_userId_createdAt_idx" ON "Reservation"("userId", "createdAt");
