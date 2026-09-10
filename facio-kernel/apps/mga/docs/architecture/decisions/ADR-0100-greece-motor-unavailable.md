---
title: Greece Motor is not an offered product
audience: architect
status: living
owner: platform-eng
reviewed: 2026-09-06
binding: true
---

# ADR-0100: Greece Motor is unavailable

## Status
Accepted, implementing Peter's approved product correction adopted by Uriel.
Supersedes the Greece MOTOR parity assumption in ADR-0053; its HEALTH gate remains unchanged.

## Decision
- Abbeygate does not offer Motor in Greece. There is no GR/MOTOR jurisdiction configuration, rating tax profile, Green Card preset, or new-business product entry.
- The existing jurisdiction resolver remains the authority, projected to HTTP callers by the product-channel application service. A channel switch or back-office role cannot authorise an absent country/product configuration.
- Product-bound email dispatch resolves an omitted product from the operating tenant’s Policy and fails closed without an identity. Generic synthetic previews, non-policy payment requests and other non-product notifications retain their existing scope. Operator and UW invite entrypoints check availability before creating or changing lead/session data.
- Public/client quote entry, back-office new submissions, rating, payment, issuance and sales/renewal communications reject an unsupported product using that same authority.
- Public/client Motorbike quick starts inherit their parent product's country availability.
- Preserve historical policy, invitation, communication and document records. Existing issued documents remain available; do not rerender them as a new Greek Motor pack.
- Existing database Program, BinderProductAuthority and channel rows require a separately reviewed deactivation list; this code change makes no data correction.
- Dispatcher activation remains subject to the coordinated launch approval; this change does not enable it.

## Evidence and consequence
The jurisdiction scaffold was restored in commit `632d33a9`; the May 2026 tenant migration created product Program rows across countries. ADR-0053 later assumed Greece Motor parity. Peter's explicit correction establishes that this software configuration did not represent an offered product.

## Verification
Exercise rejected Greece entry/rating/issuance/renewal paths and permitted CY/PT/ES Motor paths. No mutation or dispatch may occur after the unavailable-product gate fails.
