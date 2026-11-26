import type { RegisteredTool } from '@odudu/mcp';

// The assistant never reads the record of what it did: its own audit rows, its
// runs and its conversations are an auditor's to read, not a model's.
const OWN_RECORD = /\/:tenant\/(?:audit|agents|assistant)(?:\/|$)/u;

/** The tools a turn may offer: the reads, less those that read the assistant's own record. */
export function assistantTools(tools: readonly RegisteredTool[]): RegisteredTool[] {
  return tools.filter((tool) => tool.access === 'read' && !OWN_RECORD.test(tool.routeKey));
}
