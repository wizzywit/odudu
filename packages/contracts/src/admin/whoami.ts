import { z } from 'zod';

export const whoamiResponseSchema = z.object({
  subjectId: z.string(),
  issuerTenantId: z.string(),
  capabilities: z.array(z.string()),
  crossTenant: z.boolean(),
});
export type WhoamiResponse = z.infer<typeof whoamiResponseSchema>;
