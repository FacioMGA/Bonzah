---
title: Electric vehicle power is recorded in kW
audience: architect
status: draft
owner: platform-eng
reviewed: 2026-09-06
binding: true
supersedes:
  - ADR-0016
---

# ADR-0102: Motor EV power uses manufacturer combined kW

## Decision

1. `electricPowerKw` is the sole Motor EV power attribute. It records the
   manufacturer's maximum combined power in kilowatts; battery capacity is not
   an underwriting or rating input.
2. It is required for `fuelType === 'Electric'` in the wizard, bind and issue
   validators. Combustion vehicles use `engineSize` in cc and must not supply
   `electricPowerKw`.
3. The published, mapped Motor programme definition owns the EV kW bands,
   referral threshold and every monetary result. Product code owns only the
   typed input and validation. Missing programme configuration fails closed;
   there is no static kW factor, rate table, or automatic load.
4. Historic EV records are not backfilled from `batteryKWh` or inferred from a
   make/model. A rerate, renewal or issuance touch without `electricPowerKw`
   is referred for the real manufacturer value.
5. Documents show the supplied kW value for EVs and cc for combustion vehicles.

## Evidence and verification

Peter's Santam instruction requires power type plus manufacturer maximum
combined kW for electric vehicles and identifies EV8/EV9 as referral bands.
The Santam binder rating schedule is not yet available, so no programme may be
published or online-rated from this change alone. Verify an EV quote accepts a
real kW value, rejects a missing value, produces the referral when no mapped
programme model is available, and renders kW rather than cc in its draft pack.

## Consequences

This supersedes ADR-0016's kWh field and 1cc sentinel. The existing all-product
programme-definition cutover (ADR-0101) remains the authority path for the
eventual Santam model and its approved discretionary 20% underwriting cap.
