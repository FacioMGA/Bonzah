# `@facio/validation`

Single source of truth for Abbeygate validation. Owns the Zod-based rule
combinators, the `ValidationProfile` registry, the `validateForContext`
runner, and the small set of types every consumer needs.

## Layout

```
src/
  types.ts                      ValidationProfile, FieldContract, etc.
  registry.ts                   ValidationRegistry singleton class
  runner.ts                     createRunner(resolveRule) -> { validateForContext, applyValidationErrors }
  rules-pure.ts                 Email, Name, DOB, OneOf, MustAccept, BoolFlag, ...
  rules-phone.ts                createPhoneE164({ phoneValidator })
  rules-registry.ts             createRuleRegistry({ phoneValidator })
                                createResolveRule(registry)
  createValidationContext.ts    factory wiring everything together
  index.ts                      env-agnostic exports
  adapters/
    frontend.ts                 pre-built FE context (uses react-phone-number-input)
    backend.ts                  pre-built BE context (uses libphonenumber-js)
```

## Consumer usage

Frontend:

```ts
import { validateForContext, ValidationRegistry, Email } from '@facio/validation/frontend';
```

Backend:

```ts
import { validateForContext, ValidationRegistry, Email } from '@facio/validation/backend';
```

Env-agnostic surfaces (profile definitions, types-only consumers):

```ts
import type { ValidationProfile } from '@facio/validation';
import { Email, Name } from '@facio/validation';
```

## Why subpath exports instead of a per-side bootstrap?

The single environment-specific dependency in this library is the phone
number validator. Frontend uses `react-phone-number-input` (a React
package — but only the pure `isPossiblePhoneNumber` helper); backend uses
`libphonenumber-js` directly to avoid pulling React server-side.

Exposing the wiring through `./frontend` and `./backend` subpath exports
means:

- Consumers never instantiate the context themselves.
- There is no per-side bootstrap directory to drift.
- Tree-shaking and conditional resolution keep React out of backend bundles.

## Build pipeline

- `npm run build` emits `dist/` via `tsc -p tsconfig.json`.
- The package is compiled BEFORE backend (`build:api`) so `node backend/dist/index.js` resolves `@facio/validation/backend` to compiled JS at runtime.
- Frontend (Vite) and Vitest read source directly via `resolve.alias`.
- Backend dev (`tsx watch`) and `tsc --noEmit` resolve source via tsconfig `paths`.
