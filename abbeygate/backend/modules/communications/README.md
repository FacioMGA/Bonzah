# Communications Hub

Shared communications workspace and delivery pipeline for Policy, Claim, and Account surfaces.

## Purpose

The communications hub provides one reusable conversation system across operational surfaces:

- Policy communications
- Claim communications
- Account communications
- Internal notes
- Outbound channel delivery
- Inbound channel capture
- Delivery attempts, retries, and approval-aware compose flows

It is designed as a shared product/workspace rather than isolated one-off tabs.

## Current scope

### Implemented

- Shared frontend communications workspace reused by:
  - `POLICY`
  - `CLAIM`
  - `ACCOUNT`
- Outbound delivery:
  - `EMAIL`
  - `SMS`
  - `WHATSAPP`
- Internal note logging
- Template listing, variable discovery, and preview rendering
- Delivery attempt tracking
- Manual retry
- Timeline projection with:
  - outbound events
  - inbound events
  - internal notes
  - failures
  - retries
  - approval states
  - template-render context
- Attachment upload and inline composer display
- Inbound webhooks:
  - email inbound
  - SMS inbound
  - WhatsApp inbound
- Twilio delivery status callback handling

### Partially implemented / operational notes

- SMS and WhatsApp currently use Twilio-backed outbound delivery.
- Inbound/status webhooks require provider signatures in every environment.
- Email inbound uses the existing communications webhook route and replay protection.
- Account communications now use the shared communications workspace directly instead of a simple table.

## Architecture

### Frontend

- Shared product entry:
  - `frontend/src/products/communications/index.ts`
- Main workspace:
  - `frontend/src/products/communications/views/CommunicationsTab.tsx`
- Composer:
  - `frontend/src/products/communications/views/ComposerArea.tsx`
- Timeline:
  - `frontend/src/products/communications/views/Timeline.tsx`
  - `frontend/src/products/communications/views/TimelineEventCard.tsx`
- Controller:
  - `frontend/src/products/communications/hooks/useCommunicationsController.ts`
- API client:
  - `frontend/src/products/communications/api/communicationsApiClient.ts`

### Backend

- HTTP transport:
  - `backend/modules/communications/http/communicationsRouter.ts`
  - `backend/modules/communications/http/templatesRouter.ts`
  - `backend/modules/communications/http/webhooksRouter.ts`
- App layer:
  - `backend/modules/communications/app/commands/sendMessageCommand.ts`
  - `backend/modules/communications/app/communicationsService.ts`
  - `backend/modules/communications/app/recipientResolver.ts`
  - `backend/modules/communications/app/queries/timelineProjections.ts`
- Infra delivery:
  - `backend/modules/communications/infra/providerRouter.ts`
  - `backend/modules/communications/infra/adapters/emailAdapter.ts`
  - `backend/modules/communications/infra/adapters/twilioAdapter.ts`
- Worker:
  - `COMM.OUTBOUND_QUEUED` handled by `backend/workers/handlers/COMMUNICATION_OUTBOUND.ts`

### Event flow

1. UI posts a message/intention to `communicationsRouter`
2. `sendMessageCommand` validates and persists the message
3. outbound items append an outbox event
4. relay pushes the event to BullMQ
5. `COMM.OUTBOUND_QUEUED` processes delivery
6. provider adapter returns status + external IDs
7. delivery attempt and message state are updated
8. timeline projection reads both message and attempt data
9. inbound/status webhooks update the same thread/message lifecycle

## Supported channels

### Email

- Outbound:
  - SMTP body delivery
  - SendGrid template delivery path
- Inbound:
  - email inbound webhook
- Status:
  - message lifecycle tracked via message + delivery attempt state

### SMS

- Outbound:
  - Twilio message create API
- Inbound:
  - `/api/webhooks/sms/inbound`
- Status:
  - `/api/webhooks/twilio/status`

### WhatsApp

- Outbound:
  - Twilio WhatsApp message create API
- Inbound:
  - `/api/webhooks/whatsapp/inbound`
- Status:
  - `/api/webhooks/twilio/status`

## Environment variables

### Existing email variables

- `SENDGRID_API_KEY`
- `EMAIL_FROM_ADDRESS`
- `INBOUND_WEBHOOK_SECRET`
- `SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY`

### Twilio variables

- `PUBLIC_API_BASE_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_FROM`
- `TWILIO_SMS_MESSAGING_SERVICE_SID`
- `TWILIO_WHATSAPP_FROM`

Notes:

- Use either `TWILIO_SMS_FROM` or `TWILIO_SMS_MESSAGING_SERVICE_SID` for SMS sends.
- `TWILIO_WHATSAPP_FROM` should be in Twilio WhatsApp format, e.g. `whatsapp:+14155238886`.

## Main routes

### Workspace routes

- `GET /api/communications/threads`
- `GET /api/communications/recipients`
- `GET /api/communications/timeline`
- `POST /api/communications/messages`
- `POST /api/communications/messages/:id/retry`
- `GET /api/communications/messages/:id/delivery-attempts`
- `POST /api/communications/messages/:id/request-approval`
- `POST /api/communications/messages/:id/approve`
- `POST /api/communications/messages/:id/reject`
- `POST /api/communications/attachments`
- `GET /api/communications/summary`
- `GET /api/communications/failed-deliveries`
- `POST /api/communications/draft`
- `GET /api/communications/next-actions`
- `GET /api/communications/cross-context`

### Webhook routes

- `POST /api/webhooks/email/inbound`
- `POST /api/webhooks/twilio/status`
- `POST /api/webhooks/sendgrid/events`

### Template routes

- `GET /api/templates`
- `GET /api/templates/:id/variables`
- `POST /api/templates/render`

### Public webhook routes

- `POST /api/webhooks/email/inbound`
- `POST /api/webhooks/sms/inbound`
- `POST /api/webhooks/whatsapp/inbound`
- `POST /api/webhooks/twilio/status`

## Data model

Core Prisma models:

- `CommunicationThread`
- `CommunicationMessage`
- `CommunicationTemplate`
- `CommunicationParticipant`
- `CommunicationDeliveryAttempt`

These live in:

- `prisma/schema.prisma`

## Operational guidance

- The timeline is intended to be the single surface for message history and operational communication events.
- The composer is progressive: compact first, richer only when needed.
- Keep unsupported channel UI hidden or clearly disabled unless the provider path is active.
- Persist provider message IDs when available so status callbacks can correlate reliably.

## Validation checklist

- `npm run type-check`
- `npm run lint`
- `npm run test:webhook-inbound-auth`

For runtime validation with real providers:

- confirm env vars are set
- send outbound SMS
- send outbound WhatsApp
- confirm Twilio callback reaches `/api/webhooks/twilio/status`
- confirm inbound webhook reaches the correct thread
