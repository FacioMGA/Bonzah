# Bonzah and Summit Demo Websites

This repository contains both public rental-insurance demo websites requested for the Bonzah project.

| Website | Local route | Source |
| --- | --- | --- |
| Bonzah | `http://localhost:5173/bonzah` | [`abbeygate/frontend/src/products/rental/BonzahDirectPage.tsx`](./abbeygate/frontend/src/products/rental/BonzahDirectPage.tsx) |
| Summit Rentals | `http://localhost:5173/summit-rentals` | [`abbeygate/frontend/src/products/rental/SummitRentalDemoPage.tsx`](./abbeygate/frontend/src/products/rental/SummitRentalDemoPage.tsx) |

Both websites are served by the public Vite frontend in `abbeygate/`. Shared demo API integration lives alongside them under `abbeygate/frontend/src/products/rental/`, and static branding and vehicle imagery live under `abbeygate/frontend/public/assets/`.

## Run locally

```bash
cd abbeygate
npm install
npm run dev:frontend
```

Then open either route listed above.

## Build the public websites

```bash
cd abbeygate
npm install
npm run build:frontend:public
```

The deployable static output is written to `abbeygate/frontend/dist/`. Vercel routing for both websites is defined in [`abbeygate/vercel.json`](./abbeygate/vercel.json).

## Repository layout

- `abbeygate/` — the web application, both demo websites, shared frontend code, and Bonzah demo API.
- `facio-kernel/` — the Facio insurance kernel and Bonzah configuration/runtime contracts.
- `postman/collections/` — sanitized demo request definitions.

Local credentials, customer-provided source documents, generated builds, dependencies, and temporary browser artifacts are intentionally excluded from version control.
