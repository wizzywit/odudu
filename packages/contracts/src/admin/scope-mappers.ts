import { z } from 'zod';

// `available` is the registry's own catalogue of mapper names — the same
// `ClaimMapperRegistry` the issuance path assembles claims from — and
// `bound` is this scope's own override, empty when the scope has no
// binding rows and falls back to its declared mappers.
export const scopeMappersSchema = z.object({
  available: z.array(z.string()),
  bound: z.array(z.string()),
});
export type ScopeMappers = z.infer<typeof scopeMappersSchema>;

export const setScopeMappersRequestSchema = z.object({
  mapper_names: z.array(z.string()),
});
export type SetScopeMappersRequest = z.infer<typeof setScopeMappersRequestSchema>;
