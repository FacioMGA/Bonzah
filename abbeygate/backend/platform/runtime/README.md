# Scripts (intentionally kept)

This directory is for **long-lived, reviewed** operational scripts that are safe and expected to exist in-repo.

## Rules

- If a script is a **one-off investigation/debug helper**, don't commit it. Use a local scratch file or a short-lived branch.
- If a script is required for operations, it must:
  - be documented (what it does / how to run / expected env vars)
  - be idempotent when possible
  - avoid printing secrets / PII

