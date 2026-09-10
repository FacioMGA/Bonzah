# BDX Export Inventory (Single-Path Cleanup)

This inventory is export-only and excludes import service code.

## ACTIVE

- `backend/modules/policy/http/bordereauxRouter.ts`
  - `GET /v5.2/:stream/preview`
  - `GET /v5.2/:stream`
- `backend/modules/reporting/domain/bordereaux/lloydsV52.ts`
  - `fetchLloydsV52BordereauxRows`
  - `validateLloydsV52Rows`
  - `validateLloydsV52RowsOrThrow`
  - `buildLloydsV52ExportMetadata`
- `backend/modules/reporting/domain/crsV52Motor.ts`
  - `CRS_V52_MOTOR_RISK_COLUMNS`
  - `CRS_V52_MOTOR_PREMIUM_COLUMNS`
  - `CRS_V52_MOTOR_CLAIMS_COLUMNS`
- `backend/workers/handlers/XLSX.GENERATE_BORDEREAUX_V52.ts`
- `frontend/src/surfaces/bo/pages/ReportingPage.tsx`
- `frontend/src/shared/api/boApiClient.ts`
  - preview + export methods only

## SHARED_KEEP

- `backend/modules/policy/http/reportsRouter.ts`
  - dashboard-only endpoints
- `backend/http/routes/bo.ts`
  - mounts `/bordereaux` and `/reports`
- `backend/http/routes/bordereaux.ts`
  - router adapter
- `backend/http/routes/reports.ts`
  - router adapter
- `backend/modules/policy/app/reportingInterop.ts`
  - stable reporting-domain re-exports

## COMPLETED_REMOVALS

These entries were removed and are kept here as an audit trail.

- `backend/modules/reporting/http/reportingRouter.ts`
  - duplicate legacy `POST /runs` implementation
- `backend/modules/reporting/app/reportGenerator.ts`
  - pre-CR-first export generator lane
- `backend/modules/reporting/domain/reportGenerator.ts`
  - legacy wrapper for deprecated generator
- `backend/modules/reporting/domain/__tests__/bordereaux.test.ts`
  - tests for deprecated generator lane
- `backend/modules/reporting/domain/bordereaux/__tests__/lloydsV52.wiring.test.ts`
  - alias-compat test only
- `frontend/src/shared/api/boApiClient.ts`
  - removed deprecated aliases: `generateLloydsBdxMonthlyRun`, `generateReportRun`, `downloadBordereauxExport`
- `frontend/src/products/settings/api/settingsApiClient.ts`
  - removed stale BDX export methods: `generateLloydsBdxMonthlyRun`, `generateReportRun`, `getBordereaux`
