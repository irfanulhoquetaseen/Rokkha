-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CITIZEN', 'HOSPITAL_STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "HospitalType" AS ENUM ('GOVT', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('COUNTABLE', 'STATUS');

-- CreateEnum
CREATE TYPE "RequirementLevel" AS ENUM ('CRITICAL', 'PREFERRED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'ARRIVED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'SOURCE_CHECKED', 'MEDICALLY_REVIEWED');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'O_POS', 'O_NEG', 'AB_POS', 'AB_NEG');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CITIZEN',
    "hospitalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "type" "HospitalType" NOT NULL,
    "freeService" BOOLEAN NOT NULL,
    "liveDataEnabled" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "consumable" BOOLEAN NOT NULL,
    "nameBn" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "bloodGroup" "BloodGroup",
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HospitalResource" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "resourceTypeId" TEXT NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HospitalResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Condition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameBn" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionRequirement" (
    "id" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "resourceTypeId" TEXT,
    "isBlood" BOOLEAN NOT NULL DEFAULT false,
    "level" "RequirementLevel" NOT NULL,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConditionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodCompatibility" (
    "donor" "BloodGroup" NOT NULL,
    "recipient" "BloodGroup" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BloodCompatibility_pkey" PRIMARY KEY ("donor","recipient")
);

-- CreateTable
CREATE TABLE "FirstAidGuide" (
    "id" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "dosBn" TEXT[],
    "dosEn" TEXT[],
    "dontsBn" TEXT[],
    "dontsEn" TEXT[],
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirstAidGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "resourceTypeId" TEXT NOT NULL,
    "hospitalResourceId" TEXT NOT NULL,
    "conditionId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationEvent" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "fromStatus" "ReservationStatus",
    "toStatus" "ReservationStatus" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoldOutEvent" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "resourceTypeId" TEXT NOT NULL,
    "conditionId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoldOutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_hospitalId_idx" ON "User"("hospitalId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_slug_key" ON "Hospital"("slug");

-- CreateIndex
CREATE INDEX "Hospital_type_idx" ON "Hospital"("type");

-- CreateIndex
CREATE INDEX "Hospital_district_idx" ON "Hospital"("district");

-- CreateIndex
CREATE INDEX "Hospital_liveDataEnabled_idx" ON "Hospital"("liveDataEnabled");

-- CreateIndex
CREATE INDEX "Hospital_freeService_idx" ON "Hospital"("freeService");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceType_code_key" ON "ResourceType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceType_bloodGroup_key" ON "ResourceType"("bloodGroup");

-- CreateIndex
CREATE INDEX "HospitalResource_resourceTypeId_idx" ON "HospitalResource"("resourceTypeId");

-- CreateIndex
CREATE INDEX "HospitalResource_updatedAt_idx" ON "HospitalResource"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HospitalResource_hospitalId_resourceTypeId_key" ON "HospitalResource"("hospitalId", "resourceTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "Condition_code_key" ON "Condition"("code");

-- CreateIndex
CREATE INDEX "ConditionRequirement_conditionId_idx" ON "ConditionRequirement"("conditionId");

-- CreateIndex
CREATE UNIQUE INDEX "FirstAidGuide_conditionId_key" ON "FirstAidGuide"("conditionId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_idempotencyKey_key" ON "Reservation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Reservation_userId_status_idx" ON "Reservation"("userId", "status");

-- CreateIndex
CREATE INDEX "Reservation_hospitalId_status_idx" ON "Reservation"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ReservationEvent_reservationId_idx" ON "ReservationEvent"("reservationId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "SoldOutEvent_createdAt_idx" ON "SoldOutEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SoldOutEvent_resourceTypeId_createdAt_idx" ON "SoldOutEvent"("resourceTypeId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalResource" ADD CONSTRAINT "HospitalResource_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HospitalResource" ADD CONSTRAINT "HospitalResource_resourceTypeId_fkey" FOREIGN KEY ("resourceTypeId") REFERENCES "ResourceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionRequirement" ADD CONSTRAINT "ConditionRequirement_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "Condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionRequirement" ADD CONSTRAINT "ConditionRequirement_resourceTypeId_fkey" FOREIGN KEY ("resourceTypeId") REFERENCES "ResourceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirstAidGuide" ADD CONSTRAINT "FirstAidGuide_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "Condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_resourceTypeId_fkey" FOREIGN KEY ("resourceTypeId") REFERENCES "ResourceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_hospitalResourceId_fkey" FOREIGN KEY ("hospitalResourceId") REFERENCES "HospitalResource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoldOutEvent" ADD CONSTRAINT "SoldOutEvent_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoldOutEvent" ADD CONSTRAINT "SoldOutEvent_resourceTypeId_fkey" FOREIGN KEY ("resourceTypeId") REFERENCES "ResourceType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written constraints (defense in depth; see CLAUDE.md 3.1)
ALTER TABLE "HospitalResource" ADD CONSTRAINT "hospital_resource_stock_bounds"
  CHECK ("available" >= 0 AND "available" <= "total" AND "total" >= 0);

ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "ConditionRequirement" ADD CONSTRAINT "condition_requirement_target"
  CHECK (("resourceTypeId" IS NOT NULL) <> "isBlood");

CREATE UNIQUE INDEX "reservation_one_active_per_type"
  ON "Reservation" ("userId", "resourceTypeId")
  WHERE "status" IN ('HELD', 'ARRIVED');

ALTER TABLE "Hospital" ADD CONSTRAINT "hospital_coords_valid"
  CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
