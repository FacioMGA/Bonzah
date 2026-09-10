# Email Template Intake (CHAMPS Controlled)

## Purpose

This folder holds business-supplied source documents used to derive canonical
customer communication templates in the Communications module.

These files are **source evidence only**:

- They are not runtime template sources.
- They are not imported by backend or frontend code.
- The canonical source of truth remains:
  `backend/modules/communications/domain/customerTemplateCatalog.ts`

## CHAMPS Handling Rules

- **Single source of truth**: runtime email content must be in the template
  catalog and rendered by the communications pipeline.
- **Traceability**: each source file must be listed in `MANIFEST.json` with a
  checksum and mapping intent.
- **No hidden coupling**: no service/module may reference this folder directly.
- **Controlled updates**: replacing files requires updating checksum entries and
  mapping notes in `MANIFEST.json`.

## Mapping Scope

See `MANIFEST.json` for file-to-template intent mapping against canonical keys
such as:

- `QUOTE_STANDARD`
- `QUOTE_BANK_TRANSFER`
- `NEW_BUSINESS_CONFIRMATION`
- `RENEWAL_INVITE`
- `RENEWAL_CHASER`
- `CLAIMS_FNOL_LINK`
- `CLAIMS_INFO_REQUEST`
- `CLAIMS_DOCUMENT_REQUEST`
