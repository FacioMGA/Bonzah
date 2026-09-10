import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Required so `schema.openapi(...)` exists on zod schemas.
extendZodWithOpenApi(z);

export const openApiRegistry = new OpenAPIRegistry();

// Define security scheme for API Keys globally
openApiRegistry.registerComponent('securitySchemes', 'ApiKeyAuth', {
    type: 'apiKey',
    in: 'header',
    name: 'x-api-key',
    description: 'Third-party API Key',
});

openApiRegistry.registerComponent('securitySchemes', 'TenantContext', {
    type: 'apiKey',
    in: 'header',
    name: 'x-tenant-id',
    description: '(Optional) Override default tenant ID for multi-tenant accounts',
});

export const ErrorResponseSchema = openApiRegistry.register('ErrorResponse', z.object({
    success: z.boolean().describe('Always false for errors').default(false),
    error: z.object({
        code: z.string().describe('Standardized operational code indicating the reason for the bounce-back (e.g. UNAUTHORIZED, NOT_FOUND)'),
        message: z.string().describe('Human-readable explanation of why the business logic or compliance check failed.'),
        details: z.record(z.string(), z.any()).optional().describe('Optional diagnostics outlining specific fields that failed validation.'),
    })
}));

// The generated schema document builder
export function generateOpenApiDocument() {
    const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);

    return generator.generateDocument({
        openapi: '3.1.0',
        info: {
            title: 'Facio Public API',
            version: '1.0.6',
            description: `
**Production-grade insurance distribution API.**

Facio enables distributors to embed quoting, policy issuance, endorsements, claims (FNOL), and webhook-based lifecycle sync into their platforms.

This API is designed for production-grade insurance distribution with real-time pricing, mid-term adjustments (MTA), and structured claims intake.

### End-to-End Distribution Flow
\`\`\`text
Discover Programs
      ↓
Generate Risk Pricing (Quote)
      ↓
Issue Policy
      ↓
Service Policy (Endorsements)
      ↓
Submit FNOL
      ↓
Receive Webhooks
\`\`\`

### Production Readiness
- **Rate Limits**: General API endpoints are limited to 1,000 requests per minute per tenant.
- **Idempotency**: All state-mutating requests (POST, PATCH) support the \`x-idempotency-key\` header to safely retry requests without performing the same operation twice.
- **Correlation IDs**: Pass \`x-correlation-id\` in your requests to ensure end-to-end traceability across our platforms.
- **SLAs**: We guarantee 99.99% uptime for core issuance capabilities.

### Verifying Webhook Signatures
Every webhook delivery includes an \`x-facio-signature\` header containing the SHA-256 HMAC of the payload, generated using your endpoint's secret.

**Node.js Example**
\`\`\`javascript
const crypto = require('crypto');

const signature = req.headers['x-facio-signature'];
const expected = crypto
  .createHmac('sha256', webhookSecret)
  .update(req.rawBody)
  .digest('hex');

if (signature !== expected) {
  throw new Error('Invalid signature');
}
\`\`\`

**Python Example**
\`\`\`python
import hmac
import hashlib

def verify_signature(secret: str, payload: bytes, signature: str) -> bool:
    expected = hmac.new(
        secret.encode('utf-8'),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
\`\`\`

### Changelog
- **v1.0.6**: Synchronized generated API metadata with the public developer portal reference and database-backed data models.
- **v1.0.5**: Added Webhook signature verification \`x-facio-signature\`. Introduced Endorsements MTA quote/bind endpoints.
- **v1.0.4**: Added FNOL limits and improved validation errors.
- **v1.0.0**: Initial release of Core API.
            `.trim(),
        },
        servers: [
            { url: 'https://api.facio.io/api', description: 'Facio Production API' },
            { url: 'https://abbeygate-cy.facio.io/api', description: 'Abbeygate Cyprus API' },
            { url: 'https://abbeygate-pt.facio.io/api', description: 'Abbeygate Portugal API' },
            { url: 'https://sandbox.facio.io/api', description: 'Sandbox API (Test Keys)' },
            { url: 'http://localhost:3000/api', description: 'Local Development' },
        ],
        // The security requirement applies to ALL endpoints globally
        security: [{ ApiKeyAuth: [] }],
    });
}
