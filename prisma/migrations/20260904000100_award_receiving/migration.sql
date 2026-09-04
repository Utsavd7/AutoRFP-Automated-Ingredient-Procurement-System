ALTER TABLE "Award"
  ADD COLUMN "receiving" JSONB;

ALTER TABLE "Award"
  ADD CONSTRAINT "Award_receiving_size_check"
  CHECK (
    "receiving" IS NULL
    OR octet_length("receiving"::TEXT) <= 32768
  );
