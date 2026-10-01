import { z } from 'zod';

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(140);
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(80).optional(), category: slugSchema.optional(),
  newOnly: z.enum(['true', 'false']).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'name']).default('newest'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
