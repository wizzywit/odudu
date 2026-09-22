import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareRegistrationResponse,
  startTestDatabase,
  type TestDatabase,
} from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { startAuthentication } from '#/usecase/executor';
import { beginPasskeyEnrolment, completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
import { provisionBrowserFlow } from '#/usecase/provision-flow';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

const PUBLIC_BASE_URL = 'http://localhost:3000';
const RP_ID = 'localhost';
const PASSWORD = 'correct horse battery staple';

const request: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

// The software authenticator lives in @odudu/testkit so this suite and
// the route-level one in @odudu/protocol-oidc drive the same attestation.
function registrationResponse(input: {
  challenge: string;
  rpId?: string;
  origin?: string;
  signCount?: number;
  userVerified?: boolean;
  credentialId?: Buffer;
}): unknown {
  return softwareRegistrationResponse({
    rpId: input.rpId ?? RP_ID,
    origin: input.origin ?? PUBLIC_BASE_URL,
    ...input,
  });
}

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionBrowserFlow(tx, tenantId);
}

async function seedUser(
  tx: TenantScopedDatabase,
  tenantId: string,
  username: string,
): Promise<string> {
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  await tx.insert(users).values({ subjectId: subject.id, tenantId, username });
  await tx.insert(userCredentials).values({
    id: newId(),
    tenantId,
    subjectId: subject.id,
    type: 'password',
    secretData: { hash: await hashPassword(PASSWORD) },
  });
  return subject.id;
}

// Nothing in the flow engine hands out configure-passkey on its own yet —
// no tenant-level switch asks for one — so an owed action is seeded the way
// an administrator or a future policy would add it.
async function seedSubjectOwingAPasskey(
  tenantId: string,
): Promise<{ subjectId: string; authSessionId: string }> {
  return withTenant(app.db, tenantId, async (tx) => {
    await seedTenant(tx, tenantId);
    const subjectId = await seedUser(tx, tenantId, 'ada');
    await requiredActionRepository(tx).add(tenantId, subjectId, 'configure-passkey');
    const { authSessionId } = await startAuthentication(tx, tenantId, request);
    await authenticationSessionRepository(tx).bindSubject(authSessionId, subjectId);
    return { subjectId, authSessionId };
  });
}

function begin(tenantId: string, authSessionId: string, subjectId: string) {
  return withTenant(app.db, tenantId, (tx) =>
    beginPasskeyEnrolment(tx, {
      tenantName: `tenant-${tenantId}`,
      publicBaseUrl: PUBLIC_BASE_URL,
      authSessionId,
      subjectId,
    }),
  );
}

function complete(
  tenantId: string,
  input: { subjectId: string; authSessionId: string; response: unknown; label?: string },
) {
  return withTenant(app.db, tenantId, (tx) =>
    completePasskeyEnrolment(tx, {
      tenantId,
      publicBaseUrl: PUBLIC_BASE_URL,
      ...input,
    }),
  );
}

describe('enrolling a passkey', () => {
  it('offers options carrying a challenge, and parks the challenge on the attempt', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);

    const offer = await begin(tenantId, authSessionId, subjectId);

    expect(offer.options.rp.id).toBe(RP_ID);
    expect(offer.options.challenge.length).toBeGreaterThan(0);
    expect(offer.options.user.name).toBe('ada');

    // The browser is not trusted to give the challenge back: the copy the
    // verification uses is the one on this row.
    const record = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.webauthnChallenge).toBe(offer.options.challenge);
  });

  it('[WEBAUTHN2-7.1.23-01] stores a webauthn credential whose lookup_key is the credential id', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    const offer = await begin(tenantId, authSessionId, subjectId);
    const response = registrationResponse({ challenge: offer.options.challenge, signCount: 7 });

    const outcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response,
      label: 'Yubikey',
    });

    expect(outcome.kind).toBe('enrolled');
    const stored = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'webauthn'),
    );
    expect(stored).toHaveLength(1);
    const credential = stored[0];
    expect(credential?.lookupKey).toBe(
      outcome.kind === 'enrolled' ? outcome.credentialId : 'not-enrolled',
    );
    expect(credential?.label).toBe('Yubikey');
    // The authenticator's own use count at registration: the baseline an
    // assertion has to exceed for the credential not to look cloned.
    expect(credential?.secret).toMatchObject({
      kind: 'webauthn',
      counter: 7,
      transports: ['internal'],
    });
    // The COSE key the attestation carried, kept as base64url so a later
    // assertion has something to check a signature against.
    const secret = credential?.secret;
    expect(secret?.kind === 'webauthn' && secret.publicKey.length > 0).toBe(true);
  });

  it('resolves the stored credential by its credential id', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    const offer = await begin(tenantId, authSessionId, subjectId);
    const outcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({ challenge: offer.options.challenge }),
    });
    expect(outcome.kind).toBe('enrolled');
    if (outcome.kind !== 'enrolled') return;

    const found = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).byLookupKey(outcome.credentialId),
    );
    expect(found?.subjectId).toBe(subjectId);
  });

  it('clears the required action only when the enrolment succeeds', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    await begin(tenantId, authSessionId, subjectId);

    const refused = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: { id: 'not', rawId: 'a', type: 'public-key' },
    });
    expect(refused).toEqual({ kind: 'rejected', reason: 'invalid_response' });
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        requiredActionRepository(tx).pendingFor(subjectId),
      ),
    ).toEqual(['configure-passkey']);

    const offer = await begin(tenantId, authSessionId, subjectId);
    const accepted = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({ challenge: offer.options.challenge }),
    });
    expect(accepted.kind).toBe('enrolled');
    // configure-passkey is gone, and a recovery path is owed in its place:
    // a second factor nobody can produce any more is the lockout recovery
    // codes exist to prevent.
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        requiredActionRepository(tx).pendingFor(subjectId),
      ),
    ).toEqual(['generate-recovery-codes']);
  });

  it('enrols a second passkey alongside the first', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);

    const first = await begin(tenantId, authSessionId, subjectId);
    expect(first.options.excludeCredentials).toEqual([]);
    const firstOutcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({ challenge: first.options.challenge }),
    });
    expect(firstOutcome.kind).toBe('enrolled');

    // The second offer tells the browser which authenticator already holds
    // one, so the user is steered to a different one rather than silently
    // replacing what they have.
    const second = await begin(tenantId, authSessionId, subjectId);
    expect(second.options.excludeCredentials?.map((c) => c.id)).toEqual([
      firstOutcome.kind === 'enrolled' ? firstOutcome.credentialId : 'not-enrolled',
    ]);
    const secondOutcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({ challenge: second.options.challenge }),
    });
    expect(secondOutcome.kind).toBe('enrolled');

    const stored = await withTenant(app.db, tenantId, (tx) =>
      credentialRepository(tx).listFor(subjectId, 'webauthn'),
    );
    expect(stored).toHaveLength(2);
    expect(stored.every((credential) => credential.label === 'Passkey')).toBe(true);
  });
});

describe('a response is answerable once', () => {
  it('refuses a replay of a response that already enrolled', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    const offer = await begin(tenantId, authSessionId, subjectId);
    const response = registrationResponse({ challenge: offer.options.challenge });

    expect((await complete(tenantId, { subjectId, authSessionId, response })).kind).toBe(
      'enrolled',
    );

    // The challenge went with the first verification, so there is nothing
    // left for the second to be checked against — the refusal comes from
    // the absence, not from a second look at the same value.
    const replay = await complete(tenantId, { subjectId, authSessionId, response });

    expect(replay).toEqual({ kind: 'rejected', reason: 'no_challenge' });
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'webauthn'),
      ),
    ).toHaveLength(1);
  });

  it('refuses a response with no ceremony outstanding at all', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);

    const outcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({ challenge: 'a-challenge-nobody-issued' }),
    });

    expect(outcome).toEqual({ kind: 'rejected', reason: 'no_challenge' });
  });

  it('[WEBAUTHN2-7.1.8-01] refuses a response answering a challenge other than the outstanding one', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    await begin(tenantId, authSessionId, subjectId);

    const outcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({ challenge: 'a-challenge-nobody-issued' }),
    });

    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_response' });
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'webauthn'),
      ),
    ).toEqual([]);
  });

  // The options ask for userVerification: 'required', and the verification
  // requires it too. An authenticator that would have honoured 'preferred'
  // by skipping its PIN is refused at the ceremony rather than enrolled as
  // a credential that looks like two factors and is one.
  it('[WEBAUTHN2-7.1.15-01] refuses a response whose authenticator verified nobody', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    const offer = await begin(tenantId, authSessionId, subjectId);
    expect(offer.options.authenticatorSelection?.userVerification).toBe('required');
    expect(offer.options.authenticatorSelection?.residentKey).toBe('required');

    const outcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({
        challenge: offer.options.challenge,
        userVerified: false,
      }),
    });

    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_response' });
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'webauthn'),
      ),
    ).toEqual([]);
  });

  // The same credential id twice in one tenant is what
  // user_credentials_lookup_key forbids; excludeCredentials is what stops
  // a compliant browser producing it. Reaching the write anyway is a
  // refusal, not a server fault.
  it('[WEBAUTHN2-7.1.22-01] refuses a credential id the tenant already holds', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    const first = await begin(tenantId, authSessionId, subjectId);
    const storedCredentialId = randomBytes(32);
    const response = registrationResponse({
      challenge: first.options.challenge,
      credentialId: storedCredentialId,
    });
    expect((await complete(tenantId, { subjectId, authSessionId, response })).kind).toBe(
      'enrolled',
    );

    // A fresh challenge, so the replay guard is not what refuses this —
    // the response is re-signed against the new one, carrying the same
    // credential id the first ceremony stored.
    const second = await begin(tenantId, authSessionId, subjectId);
    const outcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({
        challenge: second.options.challenge,
        credentialId: storedCredentialId,
      }),
    });

    expect(outcome).toEqual({ kind: 'rejected', reason: 'already_enrolled' });
    expect(
      await withTenant(app.db, tenantId, (tx) =>
        credentialRepository(tx).listFor(subjectId, 'webauthn'),
      ),
    ).toHaveLength(1);
  });

  it('refuses a response produced against a different relying party', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    const offer = await begin(tenantId, authSessionId, subjectId);

    const outcome = await complete(tenantId, {
      subjectId,
      authSessionId,
      response: registrationResponse({
        challenge: offer.options.challenge,
        rpId: 'attacker.example',
        origin: 'https://attacker.example',
      }),
    });

    expect(outcome).toEqual({ kind: 'rejected', reason: 'invalid_response' });
  });

  it('spends the challenge once when two responses race for it', async () => {
    const tenantId = newId();
    const { subjectId, authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    const offer = await begin(tenantId, authSessionId, subjectId);

    const outcomes = await Promise.all([
      complete(tenantId, {
        subjectId,
        authSessionId,
        response: registrationResponse({ challenge: offer.options.challenge }),
      }),
      complete(tenantId, {
        subjectId,
        authSessionId,
        response: registrationResponse({ challenge: offer.options.challenge }),
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.kind === 'enrolled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === 'rejected')).toEqual([
      { kind: 'rejected', reason: 'no_challenge' },
    ]);
  });
});

describe('authenticationSessionRepository — the webauthn challenge', () => {
  it('cannot store a challenge on a foreign tenant’s attempt', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const { authSessionId } = await startAuthentication(tx, tenantId, request);
        return authSessionId;
      },
      verifySeeded: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.webauthnChallenge).toBeNull();
      },
      attempt: async (tx, authSessionId) =>
        authenticationSessionRepository(tx).setWebauthnChallenge(authSessionId, 'a-challenge'),
      expectBlocked: () => {
        // An UPDATE matching zero rows under a foreign tenant context, not a
        // thrown error — what matters is the row below being untouched.
      },
      verifyTenantAUnaffected: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.webauthnChallenge).toBeNull();
      },
    });
  });

  it('cannot claim a foreign tenant’s challenge, and leaves it outstanding', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const { authSessionId } = await startAuthentication(tx, tenantId, request);
        await authenticationSessionRepository(tx).setWebauthnChallenge(
          authSessionId,
          'a-challenge',
        );
        return authSessionId;
      },
      verifySeeded: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.webauthnChallenge).toBe('a-challenge');
      },
      // Not the challenge, and not an error either: a reader that answered
      // with the value under a foreign tenant context would be handing out
      // another tenant's live ceremony.
      attempt: async (tx, authSessionId) =>
        authenticationSessionRepository(tx).claimWebauthnChallenge(authSessionId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: async (tx, authSessionId) => {
        const found = await authenticationSessionRepository(tx).byId(authSessionId);
        expect(found?.webauthnChallenge).toBe('a-challenge');
      },
    });
  });

  it('hands the challenge back exactly once and leaves the column null', async () => {
    const tenantId = newId();
    const { authSessionId } = await seedSubjectOwingAPasskey(tenantId);
    await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).setWebauthnChallenge(authSessionId, 'a-challenge'),
    );

    const first = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).claimWebauthnChallenge(authSessionId),
    );
    const second = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).claimWebauthnChallenge(authSessionId),
    );

    expect(first).toBe('a-challenge');
    expect(second).toBeNull();
    const record = await withTenant(app.db, tenantId, (tx) =>
      authenticationSessionRepository(tx).byId(authSessionId),
    );
    expect(record?.webauthnChallenge).toBeNull();
  });
});
