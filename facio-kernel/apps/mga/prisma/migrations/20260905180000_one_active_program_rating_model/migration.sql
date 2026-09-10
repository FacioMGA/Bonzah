-- ADR-0101: this migration establishes only the storage boundary. It must
-- never infer that a historical rating model is approved, create a rating
-- model from a runtime asset, or map either one to a binder authority.
-- Operators create, validate, publish and map models through the programme
-- definition workflow after the underlying programme data has been reviewed.

CREATE TABLE "binder_product_authority_rating_models" (
  "id" TEXT NOT NULL,
  "binderProductAuthorityId" TEXT NOT NULL,
  "programRatingModelId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "binder_product_authority_rating_models_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "binder_product_authority_rating_models_binderProductAuthorityId_key"
  ON "binder_product_authority_rating_models"("binderProductAuthorityId");
CREATE INDEX "binder_product_authority_rating_models_programRatingModelId_idx"
  ON "binder_product_authority_rating_models"("programRatingModelId");

ALTER TABLE "binder_product_authority_rating_models"
  ADD CONSTRAINT "binder_product_authority_rating_models_binderProductAuthorityId_fkey"
  FOREIGN KEY ("binderProductAuthorityId") REFERENCES "binder_product_authorities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "binder_product_authority_rating_models"
  ADD CONSTRAINT "binder_product_authority_rating_models_programRatingModelId_fkey"
  FOREIGN KEY ("programRatingModelId") REFERENCES "program_rating_models"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
