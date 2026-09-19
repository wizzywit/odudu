import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  renderUpdatePasswordPage,
  type PasskeyEnrolmentOffer,
  type RecoveryCodesOffer,
  type RequiredAction,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { type FastifyReply } from 'fastify';
import { sendHtml } from '#/view/html-response';

// What every route that can produce a 'required_action' outcome needs to
// render the page for it — login.ts's own form submission and
// consent-submission.ts's third door alike, so the two cannot drift on
// which page a given action shows. `findRealm`'s own shape, not the
// repository's `RealmLookup` — the view layer never imports repository
// (CLAUDE.md's layering table), and only `id` is read here.
export interface RequiredActionResponseDeps {
  findRealm(name: string): Promise<{ id: string } | null>;
  beginTotpEnrolment(
    realmName: string,
    realmId: string,
    subjectId: string,
  ): Promise<TotpEnrolmentOffer>;
  beginPasskeyEnrolment?(
    realmName: string,
    realmId: string,
    subjectId: string,
    authSessionId: string,
  ): Promise<PasskeyEnrolmentOffer>;
  beginRecoveryCodes(realmId: string, subjectId: string): Promise<RecoveryCodesOffer>;
}

// The one place a 'required_action' outcome becomes a response, so login.ts
// and consent.ts render the same page for the same owed action rather than
// two implementations that can drift.
export async function sendRequiredActionPage(
  reply: FastifyReply,
  deps: RequiredActionResponseDeps,
  realmName: string,
  authSessionId: string,
  subjectId: string,
  action: RequiredAction,
): Promise<FastifyReply> {
  const beginPasskey = deps.beginPasskeyEnrolment?.bind(deps);
  if (action === 'configure-passkey' && beginPasskey !== undefined) {
    const realm = await deps.findRealm(realmName);
    if (realm !== null) {
      const offer = await beginPasskey(realmName, realm.id, subjectId, authSessionId);
      return sendHtml(reply, 200, renderPasskeyEnrolmentPage(realmName, authSessionId, offer));
    }
  }
  if (action === 'generate-recovery-codes') {
    const realm = await deps.findRealm(realmName);
    if (realm !== null) {
      const offer = await deps.beginRecoveryCodes(realm.id, subjectId);
      return sendHtml(reply, 200, renderRecoveryCodesPage(realmName, authSessionId, offer));
    }
  }
  if (action === 'update-password') {
    return sendHtml(reply, 200, renderUpdatePasswordPage(realmName, authSessionId));
  }
  if (action !== 'configure-totp') {
    return sendHtml(reply, 200, renderRequiredActionPage(action));
  }
  const realm = await deps.findRealm(realmName);
  if (realm === null) {
    return sendHtml(reply, 200, renderRequiredActionPage(action));
  }
  const offer = await deps.beginTotpEnrolment(realmName, realm.id, subjectId);
  return sendHtml(reply, 200, renderTotpEnrolmentPage(realmName, authSessionId, offer));
}
