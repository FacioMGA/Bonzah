---
title: Manual underwriting approval
audience: operator
status: living
owner: platform-eng
reviewed: 2026-09-03
binding: false
---

# Manual underwriting approval

## Purpose

Manual approval releases a referred quote that an authorised underwriter has
reviewed. It is an exception decision for one recorded risk; it never supplies
the customer's declaration or bypasses payment, sanctions, or issuance gates.

## Triage

- If a customer remains on the referral quote after approval, check the Feed
  for `POLICY.UW.MANUAL_APPROVAL`, then reapply the approval once after the
  approval-resume release. Historic approvals have no risk hash and fail
  closed; they must be renewed by an underwriter.
- If the policy returns to referral after a customer changes risk information,
  that is expected. Review the changed risk and approve it again if authority
  permits.
- Do not set the customer's accuracy confirmation in BO. The customer must
  make that declaration in their own journey.
