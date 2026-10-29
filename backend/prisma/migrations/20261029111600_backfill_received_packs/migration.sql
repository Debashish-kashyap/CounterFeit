UPDATE "packs"
SET "status" = 'RECEIVED'
WHERE "status" = 'ACTIVE'
  AND "case_id" IN (
    SELECT "id"
    FROM "cases"
    WHERE "status" = 'RECEIVED'
  );
