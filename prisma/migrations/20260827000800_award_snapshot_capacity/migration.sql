-- Award decisions may include one immutable supplier snapshot per selected
-- supplier. The 2 MiB ceiling supports the bounded 1,000-item workflow while
-- still preventing unbounded JSON growth.
ALTER TABLE "Award"
  DROP CONSTRAINT "Award_supplierSnapshots_size_check";

ALTER TABLE "Award"
  ADD CONSTRAINT "Award_supplierSnapshots_size_check"
  CHECK (octet_length("supplierSnapshots"::TEXT) <= 2097152);
