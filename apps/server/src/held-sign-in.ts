import { heldSignIn, readSignInHandle } from '@odudu/authn-flows';
import { type FindHeldSignIn } from '@odudu/account';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { restartAuthorizeLocation } from '@odudu/protocol-oidc';

// How the account pages learn whether this browser still holds the sign-in a
// mailed link came out of: the cookie the login page set (authn-flows'
// sign-in-handle) resolved to its parked request, and that request rebuilt as
// the authorize path that resumes it. The two packages cannot reach each
// other, so the pair meets here. A request carrying no readable handle never
// reaches the database.
export function findHeldSignInIn(database: DatabaseHandle, tls: boolean): FindHeldSignIn {
  return async (tenant, header) => {
    if (readSignInHandle(header, tls) === null) return null;
    return withTenant(database.db, tenant.id, async (tx) => {
      const held = await heldSignIn(tx, header, tls);
      return held === null
        ? null
        : {
            sessionId: held.sessionId,
            signInPath: restartAuthorizeLocation(tenant.name, held.pendingRequest),
            clientId: held.pendingRequest.clientId,
          };
    });
  };
}
