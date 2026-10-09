import { withTenant, type DatabaseHandle } from '@odudu/db';
import { actionTokenRepository } from '#/repository/action-tokens';
import { type ActionTokenType } from '#/schema/action-tokens';
import { actionLabel, orderedActions } from '#/service/required-actions';

export interface PeekActionTokenDeps {
  readonly database: DatabaseHandle;
  readonly tenantId: string;
}

export type PeekActionTokenResult =
  | {
      kind: 'usable';
      type: ActionTokenType;
      /** An actions link's actions, as a subject reads them; empty for any other link. */
      actionLabels: readonly string[];
      /** Whether an actions link asks for a new password. */
      setsPassword: boolean;
    }
  | { kind: 'invalid' };

// The read the action-token route needs before it can decide which page to
// show: a reset-password link needs a form rendered before anything is
// consumed, unlike a verify-email link, which the route still consumes on
// the same GET. Never reached from a view directly against the repository —
// this usecase is the seam layering requires.
export async function peekActionToken(
  deps: PeekActionTokenDeps,
  key: string,
): Promise<PeekActionTokenResult> {
  const peeked = await withTenant(deps.database.db, deps.tenantId, (tx) =>
    actionTokenRepository(tx).peek(key),
  );
  if (peeked === null) return { kind: 'invalid' };
  const actions = orderedActions(peeked.actions ?? []);
  return {
    kind: 'usable',
    type: peeked.type,
    actionLabels: actions.map(actionLabel),
    setsPassword: actions.includes('update-password'),
  };
}
