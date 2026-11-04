import { z } from 'zod';
import { cursorQuerySchema, dateTimeSchema, idSchema } from '#/admin/shared';

export const DOMAIN_STATES = ['pending', 'verified', 'failed'] as const;

// The TXT record the tenant publishes to prove it controls the host. Present
// while the domain is pending; once verified or failed there is nothing left
// to publish.
export const domainDnsRecordSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type DomainDnsRecord = z.infer<typeof domainDnsRecordSchema>;

export const domainSchema = z.object({
  id: idSchema,
  host: z.string(),
  state: z.enum(DOMAIN_STATES),
  canonical: z.boolean(),
  verified_at: dateTimeSchema.nullable(),
  last_checked_at: dateTimeSchema.nullable(),
  dns_record: domainDnsRecordSchema.nullable(),
});
export type Domain = z.infer<typeof domainSchema>;

export const registerDomainRequestSchema = z.object({ host: z.string().min(1).max(512) }).strict();
export type RegisterDomainRequest = z.infer<typeof registerDomainRequestSchema>;

export const listDomainsQuerySchema = cursorQuerySchema.strict();
export type ListDomainsQuery = z.infer<typeof listDomainsQuerySchema>;

export const listDomainsResponseSchema = z.object({
  items: z.array(domainSchema),
  next: z.string().optional(),
});
export type ListDomainsResponse = z.infer<typeof listDomainsResponseSchema>;

// `path`, or a host of this tenant's own domains.
export const passkeyImpactQuerySchema = z
  .object({ canonical: z.string().min(1).max(512) })
  .strict();
export type PasskeyImpactQuery = z.infer<typeof passkeyImpactQuerySchema>;

export const passkeyImpactResponseSchema = z.object({
  subjects: z.number().int(),
  capped: z.boolean(),
});
export type PasskeyImpactResponse = z.infer<typeof passkeyImpactResponseSchema>;
