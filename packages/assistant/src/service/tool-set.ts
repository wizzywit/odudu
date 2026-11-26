import type { RegisteredTool } from '@odudu/mcp';
import { writeToolNames } from '#/service/approval-card';
import { crossTenant } from '#/service/conversation-access';

// The assistant never reads the record of what it did: its own audit rows, its
// runs and its conversations are an auditor's to read, not a model's.
const OWN_RECORD = /\/:tenant\/(?:audit|agents|assistant)(?:\/|$)/u;

/** The tools a turn may offer: the reads, less those that read the assistant's own record. */
export function assistantTools(tools: readonly RegisteredTool[]): RegisteredTool[] {
  return tools.filter((tool) => tool.access === 'read' && !OWN_RECORD.test(tool.routeKey));
}

/** The twelve changes the assistant may propose, each of which waits for the person. */
export function assistantWriteTools(tools: readonly RegisteredTool[]): RegisteredTool[] {
  return tools.filter((tool) => tool.access === 'write' && writeToolNames().has(tool.name));
}

/**
 * The tools a turn is given. In another tenant they are the ones whose route
 * names a tenant: the instance-wide reads (the tenant list and its count) have
 * no tenant in their path, so a conversation bound to one tenant is not offered
 * them, and none of them takes a tenant as an argument.
 */
export function toolsFor(
  tools: readonly RegisteredTool[],
  caller: Parameters<typeof crossTenant>[0],
): readonly RegisteredTool[] {
  return crossTenant(caller) ? tools.filter((tool) => tool.routeKey.includes('/:tenant')) : tools;
}
