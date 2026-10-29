-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('MANUFACTURER', 'PHARMACY', 'REGULATOR');

-- CreateEnum
CREATE TYPE "case_status" AS ENUM ('CREATED', 'DISPATCHED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "pack_status" AS ENUM ('ACTIVE', 'DISPENSED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "scan_target_type" AS ENUM ('PACK', 'CASE');

-- CreateEnum
CREATE TYPE "scan_result" AS ENUM ('GENUINE', 'SUSPICIOUS', 'EXPIRED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "location_name" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_lots" (
    "id" UUID NOT NULL,
    "lot_number" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,

    CONSTRAINT "api_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" UUID NOT NULL,
    "manufacturer_id" UUID NOT NULL,
    "api_lot_id" UUID,
    "drug_name" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "mfg_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cases" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "case_code" TEXT NOT NULL,
    "status" "case_status" NOT NULL DEFAULT 'CREATED',
    "received_by" UUID,
    "received_at" TIMESTAMPTZ(6),

    CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packs" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "serial" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "pack_status" NOT NULL DEFAULT 'ACTIVE',
    "scan_count" INTEGER NOT NULL DEFAULT 0,
    "first_scanned_at" TIMESTAMPTZ(6),

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" UUID NOT NULL,
    "scanned_by" UUID NOT NULL,
    "target_type" "scan_target_type" NOT NULL,
    "serial_or_code" TEXT NOT NULL,
    "result" "scan_result" NOT NULL,
    "reason" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merkle_anchors" (
    "id" UUID NOT NULL,
    "from_event_id" BIGINT NOT NULL,
    "to_event_id" BIGINT NOT NULL,
    "merkle_root" TEXT NOT NULL,
    "tx_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merkle_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "batches_manufacturer_id_created_at_idx" ON "batches"("manufacturer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "batches_manufacturer_id_batch_number_key" ON "batches"("manufacturer_id", "batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "cases_case_code_key" ON "cases"("case_code");

-- CreateIndex
CREATE INDEX "cases_batch_id_idx" ON "cases"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "packs_serial_key" ON "packs"("serial");

-- CreateIndex
CREATE INDEX "packs_case_id_idx" ON "packs"("case_id");

-- CreateIndex
CREATE INDEX "scans_serial_or_code_created_at_idx" ON "scans"("serial_or_code", "created_at");

-- CreateIndex
CREATE INDEX "scans_scanned_by_created_at_idx" ON "scans"("scanned_by", "created_at");

-- CreateIndex
CREATE INDEX "scans_result_created_at_idx" ON "scans"("result", "created_at");

-- CreateIndex
CREATE INDEX "merkle_anchors_from_event_id_to_event_id_idx" ON "merkle_anchors"("from_event_id", "to_event_id");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_api_lot_id_fkey" FOREIGN KEY ("api_lot_id") REFERENCES "api_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cases" ADD CONSTRAINT "cases_received_by_fkey" FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_scanned_by_fkey" FOREIGN KEY ("scanned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
