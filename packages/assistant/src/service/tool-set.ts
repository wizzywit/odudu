import type { RegisteredTool } from '@odudu/mcp';
import { writeToolNames } from '#/service/approval-card';

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
