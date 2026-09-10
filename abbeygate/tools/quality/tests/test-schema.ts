import { quoteDataInputSchema } from '../../backend/core/policy/quoteDataSchema.js';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

const registry = new OpenAPIRegistry();
registry.register('QuoteData', quoteDataInputSchema);
const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.0',
  info: { version: '1.0.0', title: 'Test' },
});

console.log(JSON.stringify(document.components?.schemas?.QuoteData, null, 2));
