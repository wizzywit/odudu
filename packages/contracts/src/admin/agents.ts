import { z } from 'zod';
import { booleanFlagSchema, createdAtSchema, cursorQuerySchema, idSchema } from '#/admin/shared';

export const AGENT_INSTANCE_STATES = ['live', 'expired', 'revoked'] as const;
export const AGENT_APPROVAL_STATES = [
  'pending',
  'approved',
  'denied',
  'expired',
  'consumed',
] as const;

// What an instance's own slice of writes has left; the grant's budget and the
// owner's daily window are counted separately.
export const agentBudgetSchema = z.object({
  mutating: z.number().int().nonnegative(),
  creates: z.number().int().nonnegative(),
});
export type AgentBudget = z.infer<typeof agentBudgetSchema>;

// `owner` is the subject the agent acts for and `owner_username` its username, null
// for a subject with none; `agent_client` the `client_id` of the client it runs
// under, `parent` the instance that started it, if one did.
export const agentInstanceSchema = z.object({
  id: idSchema,
  owner: idSchema,
  owner_username: z.string().nullable(),
  agent_client: z.string(),
  parent: idSchema.nullable(),
  depth: z.number().int().min(1),
  state: z.enum(AGENT_INSTANCE_STATES),
  scope: z.string(),
  created_at: createdAtSchema,
  expires_at: createdAtSchema,
  revoked_at: createdAtSchema.nullable(),
  remaining_budget: agentBudgetSchema,
});
export type AgentInstance = z.infer<typeof agentInstanceSchema>;

export const listAgentsQuerySchema = cursorQuerySchema
  .extend({
    owner: z.uuid().optional(),
    state: z.enum(AGENT_INSTANCE_STATES).optional(),
  })
  .strict();
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;

export const listAgentsResponseSchema = z.object({
  items: z.array(agentInstanceSchema),
  next: z.string().optional(),
});
export type ListAgentsResponse = z.infer<typeof listAgentsResponseSchema>;

export const deleteAgentQuerySchema = z.object({ dry_run: booleanFlagSchema.optional() }).strict();
export type DeleteAgentQuery = z.infer<typeof deleteAgentQuerySchema>;

export const revokeAgentResponseSchema = z.object({
  grants: z.number().int().nonnegative(),
  instances: z.number().int().nonnegative(),
});
export type RevokeAgentResponse = z.infer<typeof revokeAgentResponseSchema>;

export const agentApprovalSchema = z.object({
  id: idSchema,
  owner: idSchema,
  owner_username: z.string().nullable(),
  agent_client: z.string(),
  instance: idSchema.nullable(),
  kind: z.string(),
  summary: z.string(),
  state: z.enum(AGENT_APPROVAL_STATES),
  created_at: createdAtSchema,
  expires_at: createdAtSchema,
  decided_at: createdAtSchema.nullable(),
  decided_via: z.enum(['ciba_page', 'console']).nullable(),
});
export type AgentApproval = z.infer<typeof agentApprovalSchema>;

export const listAgentApprovalsQuerySchema = cursorQuerySchema
  .extend({ state: z.enum(AGENT_APPROVAL_STATES).optional() })
  .strict();
export type ListAgentApprovalsQuery = z.infer<typeof listAgentApprovalsQuerySchema>;

export const listAgentApprovalsResponseSchema = z.object({
  items: z.array(agentApprovalSchema),
  next: z.string().optional(),
});
export type ListAgentApprovalsResponse = z.infer<typeof listAgentApprovalsResponseSchema>;
