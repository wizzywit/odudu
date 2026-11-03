import type { SigningKey } from '@odudu/contracts/admin';
import { writeRefusal } from '#/shared/lib/services/capabilities';
import { removalOutcome, type RemovalOutcome } from '#/shared/lib/services/failure';
import { andList, groupedNumber } from '#/shared/lib/services/format';
import type { GatewayResult, Problem } from '#/shared/lib/services/result';

export type KeyAction = 'promote' | 'retire' | 'delete';

const VERB: Record<KeyAction, string> = {
  promote: 'promoted',
  retire: 'retired',
  delete: 'deleted',
};

const ACTIVE_TEXT =
  'The active key cannot be retired. Promote another key first, then retire this one.';
const NOT_RETIRED_TEXT = 'Only a retired key can be deleted. Retire it first.';
const GONE_TEXT = 'That key is already gone. The lanes are read again.';
const CANNOT_PROMOTE_TEXT =
  'The key can no longer be promoted: it was retired or deleted. The lanes are read again.';

function successText(action: KeyAction, key: SigningKey): string {
  const named = `The ${key.alg} key ${key.kid}`;
  switch (action) {
    case 'promote':
      return `${named} is now the active key.`;
    case 'retire':
      return `${named} was retired. It is no longer published.`;
    case 'delete':
      return `${named} was deleted.`;
  }
}

const CLIENTS = 'clients';
const MORE = 'clients.more';

// The clients the server named, and how many it left out.
function clientsText(problem: Problem): string {
  const errors = problem.errors ?? [];
  const named = errors.filter((error) => error.path === CLIENTS).map((error) => error.message);
  const more = Number(errors.find((error) => error.path === MORE)?.message ?? 0);
  if (named.length === 0) return 'the server named none';
  if (more === 0) return andList(named);
  return `${named.join(', ')} and ${groupedNumber(more)} more`;
}

function refusalText(action: KeyAction, key: SigningKey, problem: Problem): string | null {
  switch (problem.type) {
    case 'about:blank#key-active':
      return ACTIVE_TEXT;
    case 'about:blank#key-not-retired':
      return NOT_RETIRED_TEXT;
    case 'about:blank#key-algorithm-needed':
      return `Refused: no other key would produce ${key.alg}, and these clients still ask for it: ${clientsText(problem)}. Stage another ${key.alg} key, or move those clients to another algorithm, then retire this one.`;
    default:
      return action === 'promote' && problem.status === 404
        ? CANNOT_PROMOTE_TEXT
        : writeRefusal(problem, 'manage-keys');
  }
}

export function keyActionOutcome(
  action: KeyAction,
  key: SigningKey,
  result: GatewayResult<unknown>,
): RemovalOutcome {
  return removalOutcome(
    result,
    {
      doneText: successText(action, key),
      ...(action === 'promote' ? {} : { alreadyGoneText: GONE_TEXT }),
    },
    {
      name: 'The key',
      verb: VERB[action],
      lookAt: 'the lanes',
      refused: (problem) => refusalText(action, key, problem),
    },
  );
}
