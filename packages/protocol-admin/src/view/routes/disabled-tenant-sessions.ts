import { type Database } from '@odudu/db';
import { tenantIssuerFor } from '@odudu/protocol-oidc';
import {
  endDisabledTenantSessions,
  inBatches,
  type EndDisabledTenantSessionsDeps,
} from '#/usecase/end-sessions';
import { type AdminPrincipal } from '#/usecase/authenticate-admin';
import { problem, type Problem } from '#/view/problem';
import { adminTx } from '#/view/routes/admin-tx';
import { type AdminRequest } from '#/view/routes/router';

export interface DisabledTenantSessionsDeps {
  readonly database: Database;
  readonly kek: Uint8Array;
  readonly sessionsAudit: EndDisabledTenantSessionsDeps['audit'];
  readonly now: () => Date;
}

/**
 * After a disable has committed, ends the tenant's live sessions one batch
 * per transaction, in this request, and answers the problem to send when a
 * batch failed — the disable stands, and the same request ends the rest.
 */
export async function endSessionsAfterDisable(
  deps: DisabledTenantSessionsDeps,
  request: AdminRequest,
  principal: AdminPrincipal,
  targetTenantId: string,
): Promise<Problem | null> {
  const name = request.params.tenant ?? '';
  const issuer = tenantIssuerFor(request, name);
  const ending = await inBatches(() =>
    adminTx(deps.database, request, targetTenantId, (tx) =>
      endDisabledTenantSessions(
        tx,
        { kek: deps.kek, audit: deps.sessionsAudit },
        {
          tenantId: targetTenantId,
          now: deps.now(),
          issuer,
          actorSubjectId: principal.subjectId,
          actorTenantId: principal.issuerTenantId,
          actorClientId: principal.clientDbId,
        },
      ),
    ),
  );
  if (ending.failure === undefined) return null;
  request.log.error({ err: ending.failure }, 'ending a disabled tenant’s sessions failed');
  return problem(
    500,
    'about:blank#sessions-not-ended',
    'Internal Server Error',
    `${name} is disabled, but ${
      ending.remaining === null
        ? 'not all of its sessions were ended'
        : `${String(ending.remaining)} of its sessions are still live`
    }: send the same request again to end them`,
  );
}
