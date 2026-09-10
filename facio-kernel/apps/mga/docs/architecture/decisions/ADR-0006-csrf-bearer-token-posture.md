---
title: ADR-0006 CSRF bearer token posture
audience: architect
status: living
owner: platform-eng
reviewed: 2026-08-03
binding: true
---

# ADR-0006: CSRF Protection via Bearer Tokens and CORS

## Status

Accepted

## Context

Cross-Site Request Forgery (CSRF) attacks exploit cookie-based session authentication where the browser automatically attaches credentials to cross-origin requests. Traditional CSRF mitigation involves server-generated tokens embedded in forms and validated on submission.

The Abbeygate platform is a Single Page Application (SPA) that authenticates via JWT Bearer tokens sent in the `Authorization` header. The browser never automatically attaches Bearer tokens to requests — they must be explicitly included by application JavaScript.

## Decision

No dedicated CSRF middleware or token mechanism is required. The platform relies on:

1. **Bearer token authentication**: JWT tokens are stored in memory (not cookies) and manually attached to every API request via the `Authorization` header. The browser cannot be tricked into sending them automatically.

2. **Strict CORS policy**: The backend only accepts requests from explicitly allowlisted origins (`abbeygate.facio.io`, configured `CORS_ORIGIN`, and localhost in development). Cross-origin requests from attacker-controlled domains are rejected.

3. **`SameSite` cookie absence**: The application does not use session cookies. No cookies = no CSRF vector.

## Conditions for Revisiting

This decision MUST be revisited if any of the following change:

- Cookie-based sessions are introduced (e.g., for server-side rendered pages)
- `SameSite=None` cookies are used for any purpose (cross-origin cookie sharing)
- The application serves HTML forms that submit directly to the API (non-SPA flows)
- A native mobile app introduces cookie-based auth for WebView components

## Consequences

- No CSRF token generation, storage, or validation overhead.
- Simpler API surface (no `X-CSRF-Token` header requirement).
- Security auditors should be pointed to this ADR when flagging the absence of CSRF tokens.
- The frontend must never store JWT tokens in cookies (use in-memory or sessionStorage only).
