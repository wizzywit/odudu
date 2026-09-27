import { z } from 'zod';
import {
  createdAtSchema,
  cursorQuerySchema,
  enabledFilterSchema,
  idSchema,
  searchPrefixSchema,
} from '#/admin/shared';

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

// A caller may name any field it believes is a tenant field, amendable or
// not — the usecase, not this shape, is what tells the two apart and gives
// the excluded one its reason (tenant-patch.ts's `refusalFor`).
export const amendTenantRequestSchema = z.record(z.string(), z.unknown());
export type AmendTenantRequest = z.infer<typeof amendTenantRequestSchema>;

export const listTenantsResponseSchema = z.object({
  items: z.array(tenantSchema),
  next: z.string().optional(),
});
export type ListTenantsResponse = z.infer<typeof listTenantsResponseSchema>;

const tenantFilters = {
  name: searchPrefixSchema.optional(),
  display_name: searchPrefixSchema.optional(),
  enabled: enabledFilterSchema.optional(),
};
const oneTenantSearch = [
  (query: { name?: string | undefined; display_name?: string | undefined }) =>
    query.name === undefined || query.display_name === undefined,
  { message: 'search one field at a time: name or display_name, not both' },
] as const;

export const listTenantsQuerySchema = cursorQuerySchema
  .extend(tenantFilters)
  .strict()
  .refine(...oneTenantSearch);
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;

export const countTenantsQuerySchema = z
  .object(tenantFilters)
  .strict()
  .refine(...oneTenantSearch);
export type CountTenantsQuery = z.infer<typeof countTenantsQuerySchema>;
