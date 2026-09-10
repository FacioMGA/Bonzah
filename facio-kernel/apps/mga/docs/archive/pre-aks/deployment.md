---
title: Legacy App Service Deployment Guide (frozen)
status: archived
owner: platform-eng
binding: false
---

> **Frozen-on:** 2026-05-03
> **Replaced by:** [`docs/operate/deploy.md`](../../operate/deploy.md) (AKS canonical procedure)
> **Reason:** Pre-AKS Azure App Service deployment guide. Retained for historical traceability only. The env var list and GitHub secrets described here do **not** reflect the current production configuration.

# FacioMGA Deployment Guide — LEGACY (Pre-AKS)

## 1. Environment Variables Validation
Ensure the following variables are set in your Azure Web App **Environment Variables** (or App Settings) section.

| Variable Name | Description | Example / Location |
|---|---|---|
| `NODE_ENV` | Environment Mode | `production` |
| `PORT` | Listening Port | `3000` |
| `DATABASE_URL` | Postgres Connection String | `postgresql://user:pass@host:5432/abbeygate_uw?sslmode=require` |
| `JWT_SECRET` | Secret for Session Tokens | *(Long random string)* |
| `OTP_SECRET` | Secret for hashing OTP codes | *(Long random string)* |
| `SENDGRID_API_KEY` | SendGrid Key for Emails | *(set in Azure / GitHub secrets)* |
| `EMAIL_FROM_ADDRESS` | Sender for Emails | `FacioMGA@facio.io` (or `billing@abbeygateauto.com`) |
| `SENDGRID_TEMPLATE_EMAIL_VERIFICATION_OTP` | (Optional) Dynamic template for email verification OTP | *(SendGrid template id GUID)* |
| `VITE_GOOGLE_MAPS_API_KEY` | Frontend Maps Key | `AIzaSy...` |
| `GEMINI_API_KEY` | AI Features (Optional) | *(Optional)* |

### Document generation (required for binding)
Runtime generation is **local** (HTML → PDF via Puppeteer). Google Drive is **not used** in binding/quote flows.

Recommended env vars:
| Variable Name | Description | Example |
|---|---|---|
| `FRONTEND_URL` | Used for links in notifications | `https://abbeygate.facio.io` |
| `DOCX_PDF_CONVERTER_MODE` | DOCX→PDF conversion mode (async worker) | `docker` |
| `DOCX_PDF_CONVERTER_IMAGE` | LibreOffice image for conversion | `domnulnopcea/libreoffice-headless:latest` |

Optional (DOCX lane only; warn if missing):
| Variable Name | Description |
|---|---|
| `DOCGEN_CERTIFICATE_TEMPLATE_PATH` | Local DOCX certificate template path |
| `DOCGEN_QUOTE_TEMPLATE_PATH` | Local DOCX quote template path |
| `DOCGEN_INVOICE_TEMPLATE_PATH` | Local DOCX invoice template path |

## 2. Switching the Domain (`abbeygate.facio.io`)

1. Release the domain from the old App Service in the Azure Portal.
2. Add the domain to the new Web App and validate ownership via TXT or CNAME.
3. Bind a managed SSL certificate (App Service Managed Certificate).

## 3. GitHub Actions Secrets

* `AZURE_CREDENTIALS`
* `AZURE_WEBAPP_PUBLISH_PROFILE`
* `DATABASE_URL`
* `VITE_GOOGLE_MAPS_API_KEY`

`gitleaks` runs on PRs and pushes to `main` via `.github/workflows/secret-scan.yml`.

## 4. Verification

After deployment, hit `https://abbeygate.facio.io` and the `/api/health` endpoint, and log in with admin credentials.
