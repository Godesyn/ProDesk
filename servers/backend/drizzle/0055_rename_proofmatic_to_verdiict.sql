ALTER TABLE "signature_brands" RENAME COLUMN "proofmatic_url" TO "verdiict_url";
ALTER TABLE "signature_brands" RENAME COLUMN "proofmatic_reviews_url" TO "verdiict_reviews_url";

ALTER TABLE "signature_members" RENAME COLUMN "proofmatic_url" TO "verdiict_url";
ALTER TABLE "signature_members" RENAME COLUMN "proofmatic_reviews_url" TO "verdiict_reviews_url";

ALTER TYPE signature_event_type RENAME VALUE 'proofmatic_review_click' TO 'verdiict_review_click';
ALTER TYPE signature_event_type RENAME VALUE 'proofmatic_reviews_click' TO 'verdiict_reviews_click';