-- Rate-limit decisions use only the digest, count, and reset boundary.
-- No runtime path reads this timestamp, so retaining it adds write churn
-- without changing expiry, cleanup, or abuse protection.
ALTER TABLE "RateLimitBucket" DROP COLUMN "updatedAt";
