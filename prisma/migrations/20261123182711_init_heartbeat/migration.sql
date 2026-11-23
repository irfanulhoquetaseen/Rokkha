-- CreateTable
CREATE TABLE "SystemHeartbeat" (
    "id" SERIAL NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemHeartbeat_pkey" PRIMARY KEY ("id")
);
