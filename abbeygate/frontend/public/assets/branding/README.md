# Branding Assets

All MGA branding assets live here. When setting up a new customer/MGA, replace these files with the customer's branding.

## Files

| File | Usage | Where it appears |
|------|-------|-----------------|
| `favicon.svg` | Browser tab icon | All HTML entry points (`index.html`, `index.bo.html`, etc.) |
| `long-logo.svg` | Full horizontal logo (dark background) | BO sidebar, mobile nav drawer, client header, questionnaire workspace |
| `logo-white.png` | Logo for light backgrounds | Login page |
| `logo-icon.svg` | Small square logo/icon | Customer-facing quote wizard header |

## How to rebrand for a new MGA

1. Replace `favicon.svg` with the new MGA's favicon
2. Replace `long-logo.svg` with the new MGA's horizontal logo (SVG preferred, works on dark navy sidebar)
3. Replace `logo-white.png` with the new MGA's logo on white/light background (PNG, used on login page)
4. Replace `logo-icon.svg` with the new MGA's icon/square logo (SVG, used in wizard header)
5. Update page titles in `frontend/index.html` and `frontend/public/index.*.html`

No code changes required for basic rebranding.
