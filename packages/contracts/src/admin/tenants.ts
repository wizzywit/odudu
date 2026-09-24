import { z } from 'zod';
import { createdAtSchema, idSchema } from '#/admin/shared';

export const createTenantRequestSchema = z.object({
  name: z.string().min(1),
  display_name: z.string().min(1).optional(),
});
export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const tenantSchema = z.object({
  id: idSchema,
  name: z.string(),
  display_name: z.string().nullable(),
  enabled: z.boolean(),
  created_at: createdAtSchema,
});
export type Tenant = z.infer<typeof tenantSchema>;

export const listTenantsResponseSchema = z.object({
  items: z.array(tenantSchema),
  next: z.string().optional(),
});
export type ListTenantsResponse = z.infer<typeof listTenantsResponseSchema>;
