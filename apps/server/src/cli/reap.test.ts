import { loadConfig } from '@odudu/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertReapOrder,
  reapCommand,
  REAP_ORDER,
  retentionPolicyFromConfig,
  type TableName,
} from '#/cli/reap';

const MINIMAL = {
  ODUDU_DATABASE_URL: 'postgres://localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 7).toString('base64'),
};

describe('the order the retention pass runs in', () => {
  it('covers every rule exactly once', () => {
    expect(() => {
      assertReapOrder();
    }).not.toThrow();
    expect(new Set(REAP_ORDER).size).toBe(REAP_ORDER.length);
  });

  // Ordering is a correctness property here: a grant deleted before the
  // rows referencing it takes them with it through ON DELETE CASCADE,
  // uncounted, and a session deleted before its grants has its grants
  // nulled instead of kept.
  it('refuses an order that puts a table before what it depends on', () => {
    const inverted = REAP_ORDER.filter((table) => table !== 'refresh_tokens');
    expect(() => {
      assertReapOrder(['refresh_tokens', ...inverted]);
    }).not.toThrow();
    expect(() => {
      assertReapOrder([
        'token_grants',
        'refresh_tokens',
        'authorization_codes',
        'authentication_sessions',
        'action_tokens',
        'client_registration_tokens',
        'login_failures',
        'email_outbox',
        'sessions',
      ]);
    }).toThrow(/token_grants before refresh_tokens/u);
  });

  it('refuses an order that omits a table', () => {
    const short = REAP_ORDER.filter((table) => table !== 'action_tokens');
    expect(() => {
      assertReapOrder(short);
    }).toThrow(/omits action_tokens/u);
  });

  it('refuses an order that names a table twice', () => {
    const doubled: TableName[] = [...REAP_ORDER, 'sessions'];
    expect(() => {
      assertReapOrder(doubled);
    }).toThrow(/repeats sessions/u);
  });
});

describe('the retention windows', () => {
  it('defaults to keeping a family longer than any credential in it', () => {
    const policy = retentionPolicyFromConfig(loadConfig(MINIMAL));
    expect(policy).toEqual({
      grantSeconds: 604_800,
      offlineGrantSeconds: 2_592_000,
      authorizationCodeSeconds: 3600,
      authenticationSessionSeconds: 3600,
      actionTokenSeconds: 604_800,
      registrationTokenSeconds: 604_800,
      sessionSeconds: 86_400,
      emailSentSeconds: 604_800,
      emailFailedSeconds: 2_592_000,
      emailMaxAttempts: 5,
    });
  });

  it('takes each window from the environment', () => {
    const policy = retentionPolicyFromConfig(
      loadConfig({ ...MINIMAL, ODUDU_RETENTION_GRANT_SECONDS: '1209600' }),
    );
    expect(policy.grantSeconds).toBe(1_209_600);
  });

  it('refuses a window shorter than a minute', () => {
    expect(() => loadConfig({ ...MINIMAL, ODUDU_RETENTION_SESSION_SECONDS: '30' })).toThrow(
      /RETENTION_SESSION_SECONDS/u,
    );
  });
});

describe('the connection the command reaps on', () => {
  afterEach(() => {
    delete process.env.ODUDU_DATABASE_URL;
    delete process.env.ODUDU_APP_DATABASE_URL;
    delete process.env.ODUDU_KEK;
  });

  // Demanded in every environment, not only production. The owner has to
  // bypass row-level security for the realm enumeration to work at all, so a
  // fallback to it would run every DELETE with the policy switched off — one
  // unscoped pass per realm, and no error to say so.
  it('refuses to reap without a serving connection to reap on', async () => {
    process.env.ODUDU_DATABASE_URL = MINIMAL.ODUDU_DATABASE_URL;
    process.env.ODUDU_KEK = MINIMAL.ODUDU_KEK;

    await expect(reapCommand()).rejects.toThrow(/ODUDU_APP_DATABASE_URL/u);
  });
});
