-- CreateEnum
CREATE TYPE "IncomeSourceType" AS ENUM ('PAYROLL', 'FREELANCE', 'RENTAL', 'BUSINESS', 'OTHER');

-- AlterTable
ALTER TABLE "recurring_incomes" ADD COLUMN     "adjustForWeekends" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceType" "IncomeSourceType" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "clientData" JSONB NOT NULL,
    "serverData" JSONB NOT NULL,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_conflicts_userId_resolvedAt_idx" ON "sync_conflicts"("userId", "resolvedAt");
