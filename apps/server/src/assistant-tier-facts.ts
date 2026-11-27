import type { ChatCaller, FactsReader } from '@odudu/assistant';
import { withTenantRetrying, type DatabaseHandle } from '@odudu/db';
import { clientRepository } from '@odudu/domain-tenant';
import { targetAdminReach } from '@odudu/protocol-admin';

// What an unreadable or unknown target counts as: the most the assistant must
// never touch, so a change that cannot be judged is not proposed.
const FAILS_CLOSED = {
  adminReach: ['unknown'],
  isOwner: true,
  isBuiltinClient: true,
  rootsConversationGrant: true,
} as const;

const NOTHING = {
  adminReach: [],
  isOwner: false,
  isBuiltinClient: false,
  rootsConversationGrant: false,
} as const;

/**
 * What the server reads about the record a change names, in the tenant the
 * conversation acts in, from the same queries the records' own `admin_reach`
 * comes from. A change that creates something names no record and reaches
 * nothing. A session is not read yet, so a change to one is judged as the
 * administrator's own and is not proposed.
 */
export function targetFactsFor(database: DatabaseHandle, caller: ChatCaller): FactsReader {
  const tenantId = caller.target?.id ?? caller.tenantId;
  return ({ kind, id, removes }) => {
    if (id === undefined || kind === 'other') return Promise.resolve(NOTHING);
    if (kind === 'session') return Promise.resolve(FAILS_CLOSED);
    return withTenantRetrying(database.db, tenantId, async (tx) => {
      if (kind === 'client') {
        const client = await clientRepository(tx).byId(id);
        if (client === null) return FAILS_CLOSED;
        return {
          ...NOTHING,
          isBuiltinClient: client.builtinAdmin || client.builtinMcp || client.builtinAssistant,
          adminReach: await targetAdminReach(tx, {
            kind: 'client',
            serviceSubjectId: client.serviceSubjectId,
          }),
        };
      }
      return {
        ...NOTHING,
        isOwner: kind === 'subject' && id === caller.ownerSubjectId,
        adminReach: await targetAdminReach(tx, { kind, id, subtree: removes }),
      };
    });
  };
}
