---
title: Policy cancellation processing
audience: operator
status: living
owner: platform-eng
reviewed: 2026-08-19
binding: false
---

# Policy cancellation processing

Back Office → Policy → **Service** records and processes cancellation requests.
Recording a request does not approve or cancel the policy.

Before recording a request, the policy-holder contact must contain a valid email
address, either as the standalone contact value or as `{"email":"…"}`. The
request is rejected without a lifecycle transition or notification when it is
missing or invalid; correct the policy-holder record first.

## Lifecycle

1. **Record request** moves the policy to `CANCELLATION_REQUESTED` with request
   status `RECEIVED`.
2. **Process** creates or resumes one cancellation endorsement, marks the request
   `PROCESSING`, and opens its Premium workspace for review.
3. Issuing that cancellation endorsement is the approval boundary. It requires
   the manual-refund acknowledgement and moves the policy to `CANCELLED`.
4. **Reject** records the reason and restores the issued policy lifecycle.

## Live check

Use an existing request. After Process, confirm Service shows `PROCESSING` and
Premium shows the same cancellation draft. Do not create, issue, reject, or
repeat a production cancellation solely for testing.
