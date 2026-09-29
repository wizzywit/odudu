import { z } from 'zod';

// `capped` says the collection holds more than `count`: counting stops at a
// fixed ceiling so that the answer costs no more than a bounded read.
export const countResponseSchema = z.object({
  count: z.number().int(),
  capped: z.boolean(),
});
export type CountResponse = z.infer<typeof countResponseSchema>;
