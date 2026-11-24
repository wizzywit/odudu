import { sessionRepository, SessionEntry } from '@odudu/authn-flows';
import { withTenant, type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';

// A live session for `subjectId` and the Cookie header a browser holding it
// would send; the row is written directly, so no sign-in form is involved.
export async function signedInCookie(
  app: DatabaseHandle,
  tenant: { readonly tenantId: string; readonly tenant: string },
  subjectId: string,
  now: Date,
): Promise<string> {
  const id = newId();
  const entry = SessionEntry.issue(id);
  await withTenant(app.db, tenant.tenantId, (tx) =>
    sessionRepository(tx).create({
      id,
      tenantId: tenant.tenantId,
      subjectId,
      expiresAt: new Date(now.getTime() + 24 * 3600 * 1000),
      authenticators: ['pwd'],
      secretHash: entry.secretHash(),
    }),
  );
  return `${tenant.tenant}-session=${entry.cookieValue()}`;
}
