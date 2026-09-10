import { quoteDataInputSchema } from '../../backend/core/policy/quoteDataSchema.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

console.log(JSON.stringify(zodToJsonSchema(quoteDataInputSchema, 'ProgramQuestions'), null, 2));
