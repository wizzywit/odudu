import type { RegisteredTool } from '@odudu/mcp';
import type { CardBody } from '#/repository/approvals';
import { changedFields, diffMoved, replacesState, stateMoved } from '#/service/approval-card';
import { readTarget, tierFor, type PolicyDeps } from '#/usecase/tool-approval';

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
  card: Pick<CardBody, 'before' | 'diff'>,
  deps: Pick<PolicyDeps, 'read' | 'signal'>,
): Promise<boolean> {
  if (!replacesState(entry.name)) return false;
  const found = await readTarget(deps, entry.name, input);
  if (found.kind !== 'data') return true;
  return (
    stateMoved(entry.name, changedFields(entry, input), input, card.before, found.data) ||
    diffMoved(entry.name, input, card.diff, found.data)
  );
}

/**
 * Whether a change of tier B or C is now one the assistant never makes: the
 * target, or a role or group the body grants, has come to reach an
 * administrator capability since the card was drawn. Judged again as the
 * approval is spent, from the facts as they are now; without a way to read them
 * it is judged as raised.
 */
export async function tierRaisedSinceCard(
  entry: RegisteredTool,
  input: unknown,
  card: Pick<CardBody, 'tier' | 'target'>,
  facts: PolicyDeps['facts'],
): Promise<boolean> {
  if (card.tier === 'A') return false;
  return typeof (await tierFor(facts, entry.name, input, card.target.id)) === 'object';
}
