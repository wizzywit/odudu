import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_REFUSAL_ROWS_PER_CLIENT } from '../../apps/server/src/app.js';
import { servingApp } from '../../apps/server/src/testing/served-routes.js';
import { PASSKEY } from '../../packages/authn-flows/src/service/authenticators/names.js';
import {
  generateRecoveryCodes,
  RECOVERY_CODE_COUNT,
  recoveryApplicable,
} from '../../packages/authn-flows/src/service/authenticators/recovery.js';
import { qualifiedRoleName } from '../../packages/domain-authz/src/service/role-name.js';
import { TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED } from '../../packages/contracts/src/token.js';
import {
  CLIENT_ASSERTION_TYPE,
  MAX_ASSERTION_LIFETIME_SECONDS,
} from '../../packages/protocol-oidc/src/service/client-assertion.js';
import { decideConsent } from '../../packages/protocol-oidc/src/service/consent.js';
import { REPO_ROOT } from './markdown.js';

const CONCEPTS = 'apps/docs/content/en/concepts';

const PAGES = [
  'tenants',
  'clients',
  'scopes',
  'roles-and-groups',
  'sessions',
  'tokens',
  'consent-and-audit',
  'branding',
] as const;

function body(page: string): string {
  return readFileSync(path.join(REPO_ROOT, CONCEPTS, `${page}.mdx`), 'utf8');
}

// The pages' structure, diagrams and schema facts are held by
// apps/docs/tests/concepts.test.ts. What needs the server's own code, its
// router, its consent decision and its recovery rules, is held here, where
// that code can be imported and typechecked.

// A method and path a concept page tells a reader to call, found by the shape
// `METHOD /path` in code font, compared with what the server routes.
const CALL = /`(GET|POST|PUT|PATCH|DELETE) (\/[^`\s]*)`/gu;

function shape(url: string): string {
  return url
    .replace(/\{[^}]+\}/gu, '*')
    .replace(/:[A-Za-z]+/gu, '*')
    .replace(/\/$/u, '');
}

describe('the concept pages name only routes the server has', () => {
  it('serves every method and path they call', async () => {
    const { endpoints } = await servingApp();
    const served = new Set(
      endpoints.map((endpoint) => `${endpoint.method} ${shape(endpoint.url)}`),
    );
    const named = PAGES.flatMap((page) =>
      [...body(page).matchAll(CALL)].map((match) => ({
        page,
        call: `${match[1] ?? ''} ${shape(match[2] ?? '')}`,
      })),
    );

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter(({ call }) => !served.has(call))).toEqual([]);
  });
});

describe('the audit refusal budget the consent and audit page states', () => {
  it('is the one the server applies', () => {
    expect(AUDIT_REFUSAL_ROWS_PER_CLIENT).toBe(20);
    expect(body('consent-and-audit')).toContain('20 refusals');
  });
});

describe('the consent decisions the consent and audit page describes are the ones the server takes', () => {
  const base = {
    requestedScopes: ['openid', 'email'],
    defaultScopes: ['openid'],
    optionalScopes: ['email'],
    grantedScopes: [] as string[],
    prompt: new Set<'consent' | 'none'>(),
    consentRequired: false,
  };

  it('asks when the request says prompt=consent, whatever the client is set to', () => {
    expect(decideConsent({ ...base, prompt: new Set(['consent']) }).kind).toBe('ask');
    expect(body('consent-and-audit')).toContain('prompt=consent');
  });

  it('does not ask for a client that does not require it', () => {
    expect(decideConsent(base).kind).toBe('not_required');
  });

  it('asks once, and not again for what was granted', () => {
    const required = { ...base, consentRequired: true };
    expect(decideConsent(required).kind).toBe('ask');
    expect(decideConsent({ ...required, grantedScopes: ['openid', 'email'] }).kind).toBe(
      'not_required',
    );
  });

  it('asks again when the client wants more than was granted', () => {
    const required = { ...base, consentRequired: true, grantedScopes: ['openid'] };
    expect(decideConsent(required).kind).toBe('ask');
  });

  it('refuses with consent_required when the request forbids a screen', () => {
    const refused = decideConsent({ ...base, consentRequired: true, prompt: new Set(['none']) });
    expect(refused).toEqual({ kind: 'refuse', error: 'consent_required' });
    expect(body('consent-and-audit')).toContain('prompt=none');
  });
});

describe('the recovery code rules the sessions page states are the ones the sign-in applies', () => {
  it('a recovery code stands in for an authenticator code and never follows a passkey', () => {
    const held = { hasRecoveryCodes: true };

    expect(recoveryApplicable(held, true, true, new Set([PASSKEY]))).toBe(false);
    expect(recoveryApplicable(held, true, true, new Set())).toBe(true);
    expect(recoveryApplicable({ hasRecoveryCodes: false }, true, true, new Set())).toBe(false);
  });

  it('a set holds ten codes, each of them different', () => {
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(new Set(generateRecoveryCodes(RECOVERY_CODE_COUNT)).size).toBe(RECOVERY_CODE_COUNT);
    expect(body('sessions')).toContain('ten recovery codes');
  });
});

describe('what the sessions page says ends with a session, and what does not', () => {
  const rotation = readFileSync(
    path.join(REPO_ROOT, 'packages/protocol-oidc/src/usecase/refresh-rotation.ts'),
    'utf8',
  );
  const grants = readFileSync(
    path.join(REPO_ROOT, 'packages/protocol-admin/src/usecase/grants.ts'),
    'utf8',
  );

  it('a refresh family is bound to its session only when it has one, so an offline family outlives it', () => {
    expect(rotation).toMatch(
      /if \(grant\.sessionId !== null\) \{\s*const session = await sessionRepository\(tx\)\.liveById/u,
    );
    expect(rotation).toMatch(/An\s+(?:\/\/\s*)?offline family has no session/u);
    const page = body('sessions');
    expect(page).toContain('bound to it');
    expect(page).toContain('`offline_access`');
  });

  it('an administrator revokes a client’s grants, offline ones included, without ending a session', () => {
    expect(grants).toMatch(/Revoking a grant ends no session/u);
    expect(grants).toMatch(/client\.grants_revoke/u);
    expect(body('sessions')).toContain('/grants/{clientId}');
  });
});

describe('the roles claim the roles and groups page describes', () => {
  it('writes a client role with its client in front, and a tenant role bare', () => {
    expect(qualifiedRoleName({ name: 'reader' }, 'reports-api')).toBe('reports-api:reader');
    expect(qualifiedRoleName({ name: 'reviewer' }, null)).toBe('reviewer');
    expect(body('roles-and-groups')).toContain('`reports-api:reader`');
  });
});

describe('the clients page on how a client proves who it is', () => {
  const clients = (): string => body('clients');

  it('has a table row for every method the token endpoint accepts', () => {
    const rows = clients()
      .split('\n')
      .filter((line) => line.startsWith('|'));
    for (const method of TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED) {
      expect(
        rows.some((row) => row.startsWith(`| \`${method}\``)),
        method,
      ).toBe(true);
    }
  });

  it('points to the guide that states the assertion type and the lifetime cap the code holds', () => {
    const guide = readFileSync(
      path.join(REPO_ROOT, 'apps/docs/content/en/guides/machine-to-machine.md'),
      'utf8',
    );
    expect(clients()).toContain('machine-to-machine.md#use-a-key-instead-of-a-secret');
    expect(guide).toContain(CLIENT_ASSERTION_TYPE);
    expect(MAX_ASSERTION_LIFETIME_SECONDS).toBe(300);
    expect(guide).toContain('at most five minutes');
  });

  it('says client_secret_jwt is not supported, as discovery does', () => {
    expect(TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED).not.toContain('client_secret_jwt');
    expect(clients()).toContain('`client_secret_jwt` is not supported');
  });
});
