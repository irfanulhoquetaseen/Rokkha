-- P6: add archivedAt to Hospital for soft-delete (archive) support.
ALTER TABLE "Hospital" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Hospital_archivedAt_idx" ON "Hospital" ("archivedAt");
