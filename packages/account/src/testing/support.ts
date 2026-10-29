import { type TenantScopedDatabase } from '@odudu/db';
import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import {
  credentialRepository,
  evaluatePassword,
  hashUserPassword,
  isEmailAddress,
  lockEmailForCreation,
  subjectRepository,
  userRepository,
} from '@odudu/domain-identity';
import { roleRepository } from '@odudu/domain-authz';
import { type MailGate } from '#/service/mail-gate';
import { type VerifiedAccountInput } from '#/usecase/complete-registration';
import { type TakenIdentifiers } from '#/usecase/register';

// What the composition root hands the usecases that touch identity tables
// (apps/server/src/app.ts), the same wiring over the same repositories.
export async function findTaken(
  tx: TenantScopedDatabase,
  _tenantId: string,
  who: { username: string; email: string },
): Promise<TakenIdentifiers> {
  const users = userRepository(tx);
  const byName = await users.byUsername(who.username);
  return { username: byName !== null, emailOwner: await users.holderOfEmail(who.email) };
}

export async function createVerifiedAccount(
  tx: TenantScopedDatabase,
  tenantId: string,
  input: VerifiedAccountInput,
): Promise<{ subjectId: string }> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await userRepository(tx).create({
    subjectId: subject.id,
    tenantId,
    username: input.username,
    email: input.email,
  });
  await userRepository(tx).markEmailVerified(subject.id);
  await credentialRepository(tx).insert({
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secret: { kind: 'password', hash: input.passwordHash },
  });
  for (const role of await roleRepository(tx).defaultsForTenant()) {
    await roleRepository(tx).assignToSubject(subject.id, role.id);
  }
  return { subjectId: subject.id };
}

export async function lockAddress(
  tx: TenantScopedDatabase,
  tenantId: string,
  email: string,
): Promise<void> {
  await lockEmailForCreation(tx, tenantId, email);
}

export const openMailGate: MailGate = () => true;

export const accountTestDeps = {
  endAccess: () => Promise.resolve(),
  proveAddress: () => Promise.resolve(null),
  findTaken,
  createVerifiedAccount,
  lockAddress,
  hashPassword: hashUserPassword,
  isEmailAddress,
  mailGate: openMailGate,
  resolveMailBranding: () => Promise.resolve({ branding: null, overrides: {} }),
  now: () => new Date(),
};

// The rest of what the action-token route is handed. A registration link
// needs none of it, but the route takes it whole.
export function linkRouteDeps() {
  return {
    getCurrentEmail: async (tx: TenantScopedDatabase, subjectId: string) =>
      (await userRepository(tx).bySubjectId(subjectId))?.email ?? null,
    markVerified: async (tx: TenantScopedDatabase, subjectId: string) => {
      await userRepository(tx).markEmailVerified(subjectId);
    },
    setPassword: async (tx: TenantScopedDatabase, subjectId: string, password: string) => {
      await credentialRepository(tx).setPassword(subjectId, await hashUserPassword(password));
    },
    getUsername: async (tx: TenantScopedDatabase, subjectId: string) => {
      const user = await userRepository(tx).bySubjectId(subjectId);
      if (user === null) throw new Error(`no user found for subject ${subjectId}`);
      return user.username;
    },
    evaluatePassword,
    unchangedPasswordViolations: () => Promise.resolve([]),
    clearPasswordUpdateAction: () => Promise.resolve(),
    addRequiredActions: () => Promise.resolve(),
  };
}

// What a person does with a mailed link: open it, then press the button its
// page shows, choosing a password where the page asks for one. A page with no button (a refused link) is the answer itself.
export async function openAndPress(
  http: FastifyInstance,
  tenant: string,
  key: string,
  headers: Record<string, string> = {},
  password = 'correct horse battery',
): Promise<LightMyRequestResponse> {
  const url = `/tenants/${tenant}/login-actions/action-token?key=${encodeURIComponent(key)}`;
  const opened = await http.inject({ url, headers });
  const hidden = /<input type="hidden" name="key" value="([^"]*)">/u.exec(opened.body)?.[1];
  if (opened.statusCode !== 200 || hidden === undefined || !opened.body.includes('<button')) {
    return opened;
  }
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenant}/login-actions/action-token`,
    payload: new URLSearchParams({
      key: hidden,
      ...(opened.body.includes('name="password"') ? { password } : {}),
    }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
}
