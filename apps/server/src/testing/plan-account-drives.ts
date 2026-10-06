import { type LightMyRequestResponse } from 'fastify';
import { newId } from '@odudu/kernel';
import { seed } from '#/cli/seed';
import { type Capture } from '#/testing/plan-paths';
import { REDIRECT_URI, TARGET_TENANT, type PlanWorld } from '#/testing/plan-world';

const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const ACTIONS = `/tenants/${TARGET_TENANT}/login-actions`;
const PASSWORD = 'Plan-check passw0rd, long enough';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

function expectStatus(res: LightMyRequestResponse, status: number, what: string): void {
  if (res.statusCode !== status) {
    throw new Error(
      `${what}: expected ${String(status)}, got ${String(res.statusCode)} ${res.body.slice(0, 300)}`,
    );
  }
}

async function latestMailKey(world: PlanWorld, to: string): Promise<string> {
  const [row] = await world.owner.sql<{ body_text: string }[]>`
    select body_text from email_outbox
     where tenant_id = ${world.tenantId} and to_address = ${to}
     order by created_at desc limit 1`;
  const key = row === undefined ? undefined : /[?&]key=([^&\s]+)/u.exec(row.body_text)?.[1];
  if (key === undefined) throw new Error(`no mailed link for ${to}`);
  return key;
}

// The unauthenticated account flows, and the sign-in steps that hand a
// subject to a required action.
export async function driveAccount(world: PlanWorld, capture: Capture): Promise<void> {
  const http = world.http;
  const name = `carol-${newId().slice(-8)}`;
  const address = `${name}@example.test`;
  await world.owner.sql`
    update tenants
       set registration_allowed = true, reset_password_allowed = true, verify_email = true,
           client_registration_policy = 'open', max_clients = 1000000
     where id = ${world.tenantId}`;

  const registered = await capture('account: self-registration', 'account', () =>
    http.inject({
      method: 'POST',
      url: `${ACTIONS}/registration`,
      payload: new URLSearchParams({
        username: name,
        email: address,
        password: PASSWORD,
      }).toString(),
      headers: FORM,
    }),
  );
  expectStatus(registered, 201, 'registration');
  const verifyKey = await latestMailKey(world, address);
  expectStatus(
    await capture('account: verify email', 'account', () =>
      http.inject({ url: `${ACTIONS}/action-token?key=${verifyKey}` }),
    ),
    200,
    'verify email',
  );

  expectStatus(
    await capture('account: request a password reset', 'account', () =>
      http.inject({
        method: 'POST',
        url: `${ACTIONS}/reset-password`,
        payload: new URLSearchParams({ email: address }).toString(),
        headers: FORM,
      }),
    ),
    200,
    'reset request',
  );
  expectStatus(
    await capture('account: request a password reset, unknown address', 'account', () =>
      http.inject({
        method: 'POST',
        url: `${ACTIONS}/reset-password`,
        payload: new URLSearchParams({ email: 'nobody@example.test' }).toString(),
        headers: FORM,
      }),
    ),
    200,
    'reset request, unknown',
  );
  const resetKey = await latestMailKey(world, address);
  expectStatus(
    await capture('account: open a reset link', 'account', () =>
      http.inject({ url: `${ACTIONS}/action-token?key=${resetKey}` }),
    ),
    200,
    'open reset link',
  );
  expectStatus(
    await capture('account: redeem a reset link', 'account', () =>
      http.inject({
        method: 'POST',
        url: `${ACTIONS}/action-token`,
        payload: new URLSearchParams({ key: resetKey, password: `${PASSWORD} again` }).toString(),
        headers: FORM,
      }),
    ),
    200,
    'redeem reset link',
  );

  await world.owner.sql`update tenants set login_with_email = true where id = ${world.tenantId}`;
  await world.owner.sql`
    update users set email_verified = true
     where tenant_id = ${world.tenantId} and username = 'alice'`;
  const emailQuery = new URLSearchParams({
    response_type: 'code',
    client_id: 'plans-app',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'plan-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const emailPage = await http.inject({
    url: `/tenants/${TARGET_TENANT}/protocol/openid-connect/auth?${emailQuery.toString()}`,
  });
  const emailSession = /name="auth_session_id" value="([^"]*)"/u.exec(emailPage.body)?.[1] ?? '';
  expectStatus(
    await capture('login: with an email address', 'authn', () =>
      http.inject({
        method: 'POST',
        url: `${ACTIONS}/authenticate`,
        payload: new URLSearchParams({
          auth_session_id: emailSession,
          username: 'alice@example.test',
          password: 'correct horse battery staple',
        }).toString(),
        headers: FORM,
      }),
    ),
    302,
    'login with an email address',
  );

  expectStatus(
    await capture('oidc: dynamic client registration', 'oidc', () =>
      http.inject({
        method: 'POST',
        url: `/tenants/${TARGET_TENANT}/clients-registrations/openid-connect`,
        payload: { redirect_uris: [REDIRECT_URI], client_name: 'registered by the plan check' },
      }),
    ),
    201,
    'client registration',
  );
}

// A user who has to change a password and then enrol an authenticator
// before a code is issued, walked through each required action.
export async function driveRequiredActions(world: PlanWorld, capture: Capture): Promise<void> {
  const http = world.http;
  const dave = `dave-${newId().slice(-8)}`;
  await seed(['user', '--tenant', TARGET_TENANT, '--username', dave, '--password', PASSWORD]);
  await world.owner.sql`
    insert into user_required_actions (tenant_id, subject_id, action)
    select ${world.tenantId}, subject_id, a
      from users, unnest(array['update-password', 'configure-totp', 'generate-recovery-codes', 'configure-passkey']) a
     where tenant_id = ${world.tenantId} and username = ${dave}`;

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'plans-app',
    redirect_uri: REDIRECT_URI,
    scope: 'openid',
    state: 'plan-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  const page = await http.inject({
    url: `/tenants/${TARGET_TENANT}/protocol/openid-connect/auth?${query.toString()}`,
  });
  const authSession = /name="auth_session_id" value="([^"]*)"/u.exec(page.body)?.[1] ?? '';
  const first = await capture('login: user with required actions', 'authn', () =>
    http.inject({
      method: 'POST',
      url: `${ACTIONS}/authenticate`,
      payload: new URLSearchParams({
        auth_session_id: authSession,
        username: dave,
        password: PASSWORD,
      }).toString(),
      headers: FORM,
    }),
  );
  expectStatus(first, 200, 'login with required actions');
  const next = /name="auth_session_id" value="([^"]*)"/u.exec(first.body)?.[1] ?? authSession;
  const changed = await capture('required action: update-password', 'authn', () =>
    http.inject({
      method: 'POST',
      url: `${ACTIONS}/required-action?action=update-password`,
      payload: new URLSearchParams({
        auth_session_id: next,
        password: `${PASSWORD} changed`,
      }).toString(),
      headers: FORM,
    }),
  );
  expectStatus(changed, 200, 'update-password');
}
