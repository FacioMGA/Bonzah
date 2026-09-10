import { z } from 'zod';
export const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
