-- Motor UW now consumes only Program.metadata.abbeygateMotorUwConfig and
-- fails closed on an incomplete shape. Materialise the previously deployed
-- behaviour into every Motor Program once, preserving any existing explicit
-- value. This is a data migration, not a runtime fallback.
WITH template AS (
  SELECT '{
    "allowedRiskCountries":["Cyprus","Portugal","Spain"],
    "allowedVehicleUses":["Private","SD&P","Class 1"],
    "supportedVehicleTypeTokens":["car","4x4","mpv","motorbike","motorcycle","van","pickup","motorcaravan","motorhome","caravan","classic"],
    "motorcycleAllowedVehicleUses":["SD&P","Private"],
    "motorcycleAllowedCoverRequired":["Comprehensive"],
    "motorcycleDisallowedDriverRestrictions":["ANY_DRIVER_25_PLUS","ANY_DRIVER_40_PLUS"],
    "referralFlags":{"referElectricVehicles":true,"referHybridVehicles":true,"referMotorcycle":true,"referMotorcaravan":true},
    "thresholds":{
      "declineVehicleValueOver":250000,"declineGarageTotalValueOver":250000,
      "declineClaimsCountOver5Years":3,"declineFaultClaimOver":100000,
      "declineLicenceYearsUnder":1,"declineAddedDriverAgeUnder":21,
      "declineMotorcycleRiderAgeUnder":25,"declineMotorcycleOverCcRequiresNcdCc":200,
      "referralVehicleValueOver":80000,"referralFaultClaimOver":50000,
      "referralClaimsCountAtLeast":2,"referralClaimsTotalUnder":50000,
      "referralAddedDriverAgeMin":22,"referralAddedDriverAgeMax":24,
      "referralMotorcaravanValueOver":30000,"referralMotorcaravanKmsOver":30000,
      "referralProposerAgeUnder":25,"referralStpAgeUnder":30,
      "referralStpLicenceYearsAtMost":2,"referralSeatsOver":15,
      "referralClassicVehicleValueOver":60000,"referralSeriousTechnicalConvictionsAtLeast":2
    }
  }'::jsonb AS value
), materialized AS (
  SELECT
    p."id",
    CASE
      WHEN jsonb_typeof(p."metadata") = 'object' THEN p."metadata"
      ELSE '{}'::jsonb
    END AS metadata,
    CASE
      WHEN jsonb_typeof(p."metadata"->'abbeygateMotorUwConfig') = 'object'
        THEN p."metadata"->'abbeygateMotorUwConfig'
      ELSE '{}'::jsonb
    END AS existing_config,
    template.value AS template
  FROM "programs" p
  CROSS JOIN template
  WHERE p."productType" = 'MOTOR'
), complete AS (
  SELECT
    "id",
    (metadata - 'abbeygateMotorUwConfig') || jsonb_build_object(
      'abbeygateMotorUwConfig',
      jsonb_build_object(
        'allowedRiskCountries', COALESCE(existing_config->'allowedRiskCountries', template->'allowedRiskCountries'),
        'allowedVehicleUses', COALESCE(existing_config->'allowedVehicleUses', template->'allowedVehicleUses'),
        'supportedVehicleTypeTokens', COALESCE(existing_config->'supportedVehicleTypeTokens', template->'supportedVehicleTypeTokens'),
        'motorcycleAllowedVehicleUses', COALESCE(existing_config->'motorcycleAllowedVehicleUses', template->'motorcycleAllowedVehicleUses'),
        'motorcycleAllowedCoverRequired', COALESCE(existing_config->'motorcycleAllowedCoverRequired', template->'motorcycleAllowedCoverRequired'),
        'motorcycleDisallowedDriverRestrictions', COALESCE(existing_config->'motorcycleDisallowedDriverRestrictions', template->'motorcycleDisallowedDriverRestrictions'),
        'referralFlags', (template->'referralFlags') || COALESCE(existing_config->'referralFlags', '{}'::jsonb),
        'thresholds', (template->'thresholds') || COALESCE(existing_config->'thresholds', '{}'::jsonb)
      )
    ) AS metadata
  FROM materialized
)
UPDATE "programs" p
SET "metadata" = complete.metadata,
    "updatedAt" = CURRENT_TIMESTAMP
FROM complete
WHERE p."id" = complete."id";
