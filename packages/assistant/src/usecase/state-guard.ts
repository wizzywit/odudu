import type { RegisteredTool } from '@odudu/mcp';
import type { CardBody } from '#/repository/approvals';
import { changedFields, replacesState, stateMoved } from '#/service/approval-card';
import { readTarget, type PolicyDeps } from '#/usecase/tool-approval';

/**
 * Whether the target of an approved change that replaces state no longer reads
 * as its card showed it, read again as the approval is spent. A change that
 * replaces nothing never moves. A target that cannot be read now, or is gone,
 * counts as moved, so the person's approval is never spent on something nobody
 * has looked at since.
 */
export async function movedSinceCard(
  entry: RegisteredTool,
  input: unknown,
  card: Pick<CardBody, 'before'>,
  deps: Pick<PolicyDeps, 'read' | 'signal'>,
): Promise<boolean> {
  if (!replacesState(entry.name)) return false;
  const found = await readTarget(deps, entry.name, input);
  if (found.kind !== 'data') return true;
  return stateMoved(entry.name, changedFields(entry, input), input, card.before, found.data);
}
