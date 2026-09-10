---
title: ADR-0027 Motor proposer age upper bound
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-18
binding: true
---

# ADR-0027: Motor proposer age upper bound

## Status

Accepted (Peter Sheppard confirmation, 2026-05-19).

## Context

Abbeygate asked whether an 83-year-old private motor proposer should be
referred. The supplied binder/rating rules contain these age rules only:

- Motorcycle riders under 25: decline.
- Added drivers aged 21 or under: decline.
- Added drivers aged 22-24: refer.

The platform still carried an internal private-motor proposer age rule:
`RED.PROPOSER_AGE_OVER_85`. The motor policyholder step also blocked
proposers over 85 with "Please contact us directly for cover."

Peter confirmed: "I prefer to mirror the binder wording exactly and
remove it."

## Decision

Remove the private motor proposer upper-age referral/block. Private motor
proposers over 85 remain rateable via the scheme proposer-age factor
(the existing over-80 loading still applies).

This does not change:

- Motorcycle rider under-25 decline.
- Added-driver under-21 decline.
- Added-driver 22-24 referral.
- Claims/FNOL validation for unauthorised or open-driver claimants.

## Consequences

The quote wizard, product validation, and motor underwriting automation now
mirror the supplied binder wording. Future proposer-age upper bounds require
an explicit binder/rating-rule update before implementation.
