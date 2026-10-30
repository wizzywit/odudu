import { withTenant } from '@odudu/db';
import { assetRepository, themeRepository, type ThemeBody } from '@odudu/domain-theme';
import { type FastifyInstance } from 'fastify';
import { mintAdminToken } from '#/testing/plan-admin-drives';
import { type PlanWorld, TARGET_CLIENT, TARGET_TENANT } from '#/testing/plan-world';
import { type Capture } from '#/testing/plan-paths';

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

export const BRANDING_PATHS = {
  cachedHit: 'sign-in page of a client with no theme applied, theme cached',
  themedMiss: 'sign-in page of a themed client, theme not cached',
  themedHit: 'sign-in page of a themed client, theme cached',
  overridesMiss: 'sign-in page of a client with no theme applied, overrides not cached',
  logoutPage: 'logout page of a themed tenant',
  registrationPlain: 'registration page, no return_to',
  registrationGarbage: 'registration page, return_to names no client',
  registrationClientMiss:
    'registration page, return_to names a registered client, theme not cached',
  registrationClient: 'registration page, return_to names a registered client, theme cached',
  brandImage: 'brand image file of a published theme',
  brandStylesheetCold:
    'brand stylesheet of a client theme, a wrong hash, versions not yet remembered',
  brandStylesheetRandom: 'brand stylesheet of a client theme, a wrong hash, versions remembered',
  brandStylesheet: 'brand stylesheet file of a client theme',
  brandImageRevalidate: 'brand image file, conditional request that matches',
  brandNothing: 'brand file with a name that cannot be a hash',
} as const;

const SIGN_IN =
  '<div class="plan-themed">{{intro}}{{form.open}}{{fields}}{{submit}}{{error}}{{form.close}}</div>';

function signInUrl(clientId: string, redirectUri: string): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid',
    state: 'plan-state',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
  return `/tenants/${TARGET_TENANT}/protocol/openid-connect/auth?${query.toString()}`;
}

async function render(http: FastifyInstance, url: string, themed: boolean): Promise<void> {
  const page = await http.inject({ url });
  if (page.statusCode !== 200) throw new Error(`sign-in answered ${String(page.statusCode)}`);
  if (page.body.includes('plan-themed') !== themed) {
    throw new Error(`the sign-in page was ${themed ? 'not themed' : 'themed'}`);
  }
}

// The same sign-in page three ways, each under its own name so the check can
// compare the statements: a client whose theme is cached as none, a themed
// client whose theme is not cached yet, and the same client once it is. The
// tenant and client themes carry an image, so the read joins what it names.
export async function driveBranding(world: PlanWorld, capture: Capture): Promise<void> {
  const http = world.http;
  const tenantId = world.tenantId;
  const [themed] = await world.owner.sql<{ id: string; uri: string }[]>`
    select k.id, c.redirect_uris[1] as uri
      from client_oidc_config c join clients k on k.id = c.client_id
     where k.tenant_id = ${tenantId} and k.client_id = 'app-2'`;
  const [plain] = await world.owner.sql<{ uri: string }[]>`
    select c.redirect_uris[1] as uri
      from client_oidc_config c join clients k on k.id = c.client_id
     where k.tenant_id = ${tenantId} and k.client_id = ${TARGET_CLIENT}`;
  if (themed === undefined || plain === undefined) throw new Error('a plan client is missing');

  // A render the cache has not seen, to fill it for the baseline.
  await render(http, signInUrl(TARGET_CLIENT, plain.uri), false);
  await capture(BRANDING_PATHS.cachedHit, 'oidc', () =>
    http.inject({ url: signInUrl(TARGET_CLIENT, plain.uri) }),
  );

  // A write drops the tenant's cached overrides, so the next render reads them:
  // the tenant holds 499, so this is the 500th, and the write drive sets and
  // removes the same message.
  const token = await mintAdminToken(world, { id: tenantId, name: TARGET_TENANT }, [
    'manage-tenant',
  ]);
  const overrideUrl = `/admin/tenants/${TARGET_TENANT}/message-overrides/en/login.title`;
  const written = await http.inject({
    method: 'PUT',
    url: overrideUrl,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'if-none-match': '*',
    },
    payload: JSON.stringify({ message: 'Sign in to the plan tenant' }),
  });
  if (written.statusCode !== 200) {
    throw new Error(`the plan override was refused: ${String(written.statusCode)} ${written.body}`);
  }
  const overridden = await capture(BRANDING_PATHS.overridesMiss, 'oidc', () =>
    http.inject({ url: signInUrl(TARGET_CLIENT, plain.uri) }),
  );
  if (!overridden.body.includes('Sign in to the plan tenant')) {
    throw new Error('the sign-in page did not show the override');
  }
  const logo = await withTenant(world.app.db, tenantId, (tx) =>
    assetRepository(tx).put({
      tenantId,
      sha256: 'ab'.repeat(32),
      mime: 'image/png',
      width: 4,
      height: 3,
      bytes: Buffer.from('plan-logo'),
      tenantCapBytes: 1024 * 1024,
    }),
  );
  if (logo === 'over_cap') throw new Error('the plan logo was refused');
  const body: ThemeBody = {
    tokens: { font: 'IBM Plex Mono' },
    stylesheet: null,
    templates: { 'sign-in': SIGN_IN },
    assets: { logo: { assetId: logo.id, alt: 'Plans' } },
  };
  for (const clientId of [null, themed.id]) {
    await withTenant(world.app.db, tenantId, async (tx) => {
      const themes = themeRepository(tx);
      await themes.saveDraft({ tenantId, clientId }, body, null);
      await themes.publish({ tenantId, clientId });
    });
  }

  const url = signInUrl('app-2', themed.uri);
  const miss = await capture(BRANDING_PATHS.themedMiss, 'oidc', () => http.inject({ url }));
  if (!miss.body.includes('plan-themed')) {
    throw new Error(
      `the themed sign-in was not themed: ${String(miss.statusCode)} ${miss.body.slice(0, 400)}`,
    );
  }
  const hit = await capture(BRANDING_PATHS.themedHit, 'oidc', () => http.inject({ url }));
  if (!hit.body.includes('plan-themed')) throw new Error('the cached sign-in was not themed');

  const sheet = /<link rel="stylesheet" href="(\/tenants\/[^"]+\.css)">/u.exec(hit.body)?.[1];
  if (sheet === undefined) throw new Error('the themed sign-in links no brand stylesheet');
  await driveBrandFiles(http, sheet, capture);
  await driveOtherPages(world, capture);
  // Removed on the version this drive wrote, after every render that reads the
  // cached overrides, so the write drive starts from a tenant holding 499 and
  // creates the 500th itself.
  const removed = await http.inject({
    method: 'DELETE',
    url: overrideUrl,
    headers: { authorization: `Bearer ${token}`, 'if-match': String(written.headers.etag) },
  });
  if (removed.statusCode !== 204) {
    throw new Error(`the plan override was not removed: ${String(removed.statusCode)}`);
  }
}

// What a themed page links, fetched the way a browser does: an image read by
// its hash and a stylesheet rebuilt from the layers its URL names.
async function driveBrandFiles(
  http: FastifyInstance,
  sheet: string,
  capture: Capture,
): Promise<void> {
  const image = `/tenants/${TARGET_TENANT}/brand/${'ab'.repeat(32)}.png`;
  const wrong = sheet.replace(/[0-9a-f]{64}\.css$/u, `${'0'.repeat(64)}.css`);
  for (const path of [BRANDING_PATHS.brandStylesheetCold, BRANDING_PATHS.brandStylesheetRandom]) {
    const miss = await capture(path, 'oidc', () => http.inject({ url: wrong }));
    if (miss.statusCode !== 404)
      throw new Error(`a wrong brand hash answered ${String(miss.statusCode)}`);
  }
  const answers = [
    await capture(BRANDING_PATHS.brandImage, 'oidc', () => http.inject({ url: image })),
    await capture(BRANDING_PATHS.brandStylesheet, 'oidc', () => http.inject({ url: sheet })),
  ];
  for (const answer of answers) {
    if (answer.statusCode !== 200)
      throw new Error(`a brand file answered ${String(answer.statusCode)}`);
  }
  const unchanged = await capture(BRANDING_PATHS.brandImageRevalidate, 'oidc', () =>
    http.inject({ url: image, headers: { 'if-none-match': `"${'ab'.repeat(32)}"` } }),
  );
  if (unchanged.statusCode !== 304)
    throw new Error(`a revalidation answered ${String(unchanged.statusCode)}`);
  const odd = await capture(BRANDING_PATHS.brandNothing, 'oidc', () =>
    http.inject({ url: `/tenants/${TARGET_TENANT}/brand/${'AB'.repeat(32)}.png` }),
  );
  if (odd.statusCode !== 404)
    throw new Error(`a malformed brand name answered ${String(odd.statusCode)}`);
}

// The pages a tenant theme reaches without a parked request: logout, and
// registration, whose `return_to` is checked against the tenant's clients.
async function driveOtherPages(world: PlanWorld, capture: Capture): Promise<void> {
  const http = world.http;
  const base = `/tenants/${TARGET_TENANT}`;
  const registration = (returnTo: string | null): string =>
    `${base}/login-actions/registration` +
    (returnTo === null ? '' : `?${new URLSearchParams({ return_to: returnTo }).toString()}`);
  const authorizeFor = (clientId: string): string =>
    `${base}/protocol/openid-connect/auth?client_id=${clientId}&response_type=code`;
  await world.owner
    .sql`update tenants set registration_allowed = true where id = ${world.tenantId}`;
  try {
    const logout = await capture(BRANDING_PATHS.logoutPage, 'oidc', () =>
      http.inject({ url: `${base}/protocol/openid-connect/logout` }),
    );
    if (logout.statusCode !== 200) throw new Error(`logout answered ${String(logout.statusCode)}`);
    await http.inject({ url: registration(null) });
    const answers = [
      await capture(BRANDING_PATHS.registrationPlain, 'account', () =>
        http.inject({ url: registration(null) }),
      ),
      await capture(BRANDING_PATHS.registrationGarbage, 'account', () =>
        http.inject({ url: registration(authorizeFor('no-such-client')) }),
      ),
      await capture(BRANDING_PATHS.registrationClientMiss, 'account', () =>
        http.inject({ url: registration(authorizeFor('app-3')) }),
      ),
      await capture(BRANDING_PATHS.registrationClient, 'account', () =>
        http.inject({ url: registration(authorizeFor('app-3')) }),
      ),
    ];
    for (const answer of answers) {
      if (answer.statusCode !== 200)
        throw new Error(`registration answered ${String(answer.statusCode)}`);
    }
  } finally {
    await world.owner
      .sql`update tenants set registration_allowed = false where id = ${world.tenantId}`;
  }
}
