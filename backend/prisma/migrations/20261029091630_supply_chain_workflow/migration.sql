-- CreateEnum
CREATE TYPE "scan_action" AS ENUM ('CHECK', 'SALE', 'CASE_RECEIPT');

-- AlterEnum
ALTER TYPE "pack_status" ADD VALUE 'SOLD';

-- DropForeignKey
ALTER TABLE "scans" DROP CONSTRAINT "scans_scanned_by_fkey";

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "expected_recipient_org_id" UUID,
ADD COLUMN     "shipped_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "packs" ADD COLUMN     "sold_at" TIMESTAMPTZ(6),
ADD COLUMN     "sold_by_org_id" UUID;

-- AlterTable
ALTER TABLE "scans" ADD COLUMN     "action" "scan_action" NOT NULL DEFAULT 'CHECK',
ADD COLUMN     "device_id" TEXT,
ADD COLUMN     "source_ip_hash" TEXT,
ALTER COLUMN "scanned_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "consumer_reports" (
    "id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source_ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumer_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consumer_reports_serial_created_at_idx" ON "consumer_reports"("serial", "created_at");

-- CreateIndex
CREATE INDEX "scans_source_ip_hash_created_at_idx" ON "scans"("source_ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "scans_serial_or_code_action_created_at_idx" ON "scans"("serial_or_code", "action", "created_at");

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_expected_recipient_org_id_fkey" FOREIGN KEY ("expected_recipient_org_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_sold_by_org_id_fkey" FOREIGN KEY ("sold_by_org_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_scanned_by_fkey" FOREIGN KEY ("scanned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
