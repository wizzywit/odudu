import { type RegistrationResponseJSON } from '@simplewebauthn/server';
import { softwareAuthenticator, type SoftwareAuthenticator } from '@odudu/testkit';
import { describe, expect, it } from 'vitest';
import {
  counterAdvanced,
  passkeyStep,
  type PasskeyVerification,
  type WebauthnSecret,
} from '#/service/authenticators/passkey';
import {
  parseRegistrationResponse,
  passkeyAuthenticationOptions,
  verifyPasskeyRegistration,
} from '#/service/webauthn';

const PUBLIC_BASE_URL = 'http://localhost:3000';
const RP_ID = 'localhost';
const SUBJECT_ID = '01a09678-5455-7c1f-9b1f-0f3b6f9e0001';
const CREDENTIAL_ROW_ID = '01a09678-5455-7c1f-9b1f-0f3b6f9e0002';

// One enrolment, driven through the same verification the enrolment usecase
// uses, so the stored public key and counter under test are the ones that
// path really produces rather than a hand-written fixture.
async function enrol(
  signCount: number,
): Promise<{ authenticator: SoftwareAuthenticator; secret: WebauthnSecret }> {
  const authenticator = softwareAuthenticator();
  const challenge = 'Zm9yLXJlZ2lzdHJhdGlvbi1vbmx5';
  const registered = await verifyPasskeyRegistration({
    publicBaseUrl: PUBLIC_BASE_URL,
    expectedChallenge: challenge,
    response: registrationJson(authenticator, challenge, signCount),
  });
  if (registered.kind !== 'verified') throw new Error('expected the fixture to enrol');
  return {
    authenticator,
    secret: {
      kind: 'webauthn',
      publicKey: registered.publicKey,
      counter: registered.counter,
      transports: registered.transports,
    },
  };
}

function registrationJson(
  authenticator: SoftwareAuthenticator,
  challenge: string,
  signCount: number,
): RegistrationResponseJSON {
  // The fixture hands back `unknown` on purpose, so it goes through the
  // same narrowing the enrolment route puts a browser's POST through.
  const parsed = parseRegistrationResponse(
    authenticator.registration({ challenge, rpId: RP_ID, origin: PUBLIC_BASE_URL, signCount }),
  );
  if (parsed === null) throw new Error('expected the fixture to produce a registration response');
  return parsed;
}

async function offeredChallenge(): Promise<string> {
  const { challenge } = await passkeyAuthenticationOptions(PUBLIC_BASE_URL);
  return challenge;
}

function verificationFor(secret: WebauthnSecret, expectedChallenge: string): PasskeyVerification {
  return {
    credential: { id: CREDENTIAL_ROW_ID, subjectId: SUBJECT_ID, secret },
    expectedChallenge,
    publicBaseUrl: PUBLIC_BASE_URL,
  };
}

describe('passkeyStep', () => {
  it('challenges with the passkey form when no assertion was submitted', async () => {
    const outcome = await passkeyStep(
      {},
      { credential: null, expectedChallenge: null, publicBaseUrl: PUBLIC_BASE_URL },
    );

    expect(outcome).toEqual({ kind: 'challenge', form: 'passkey' });
  });

  it('fails when the asserted credential id resolved to nothing', async () => {
    const { authenticator, secret } = await enrol(0);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge,
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: secret.counter + 1,
        }),
      },
      { credential: null, expectedChallenge: challenge, publicBaseUrl: PUBLIC_BASE_URL },
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('[WEBAUTHN2-7.2.7-01] returns the resolved subject for a valid assertion', async () => {
    const { authenticator, secret } = await enrol(4);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge,
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: 5,
        }),
      },
      verificationFor(secret, challenge),
    );

    expect(outcome).toEqual({
      kind: 'success',
      subjectId: SUBJECT_ID,
      credentialId: CREDENTIAL_ROW_ID,
      counter: 5,
    });
  });

  it('fails an assertion whose counter did not increase', async () => {
    const { authenticator, secret } = await enrol(4);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge,
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: 4,
        }),
      },
      verificationFor(secret, challenge),
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('accepts an authenticator that reports zero and has always reported zero', async () => {
    const { authenticator, secret } = await enrol(0);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge,
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: 0,
        }),
      },
      verificationFor(secret, challenge),
    );

    expect(outcome).toEqual({
      kind: 'success',
      subjectId: SUBJECT_ID,
      credentialId: CREDENTIAL_ROW_ID,
      counter: 0,
    });
  });

  it('[WEBAUTHN2-7.2.17-01] fails an assertion the authenticator did not verify anybody for', async () => {
    const { authenticator, secret } = await enrol(1);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge,
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: 2,
          userVerified: false,
        }),
      },
      verificationFor(secret, challenge),
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  // Two checks against two different values — the origin the page was
  // served from and the domain the credential is bound to — varied one at a
  // time, so neither refusal could be the other one's.
  it('[WEBAUTHN2-7.2.13-01] fails an assertion whose client data names another origin', async () => {
    const { authenticator, secret } = await enrol(1);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge,
          rpId: RP_ID,
          origin: 'https://attacker.example',
          signCount: 2,
        }),
      },
      verificationFor(secret, challenge),
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it("[WEBAUTHN2-7.2.15-01] fails an assertion signed over another relying party's id", async () => {
    const { authenticator, secret } = await enrol(1);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge,
          rpId: 'attacker.example',
          origin: PUBLIC_BASE_URL,
          signCount: 2,
        }),
      },
      verificationFor(secret, challenge),
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('[WEBAUTHN2-7.2.12-01] fails an assertion answering a challenge this server never offered', async () => {
    const { authenticator, secret } = await enrol(1);
    const offered = await offeredChallenge();

    const outcome = await passkeyStep(
      {
        assertion: authenticator.assertion({
          challenge: 'c29tZXRoaW5nLWVsc2UtZW50aXJlbHk',
          rpId: RP_ID,
          origin: PUBLIC_BASE_URL,
          signCount: 2,
        }),
      },
      verificationFor(secret, offered),
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });

  it('[WEBAUTHN2-7.2.3-01] fails when nothing shaped like an assertion was submitted', async () => {
    const { secret } = await enrol(1);
    const challenge = await offeredChallenge();

    const outcome = await passkeyStep(
      { assertion: { id: 'abc' } },
      verificationFor(secret, challenge),
    );

    expect(outcome).toEqual({ kind: 'failure', reason: 'invalid_credentials' });
  });
});

describe('counterAdvanced', () => {
  it('accepts a counter above the stored one and refuses one at or below it', () => {
    expect(counterAdvanced(4, 5)).toBe(true);
    expect(counterAdvanced(4, 4)).toBe(false);
    expect(counterAdvanced(4, 3)).toBe(false);
    expect(counterAdvanced(4, 0)).toBe(false);
  });

  it('accepts zero from an authenticator whose stored counter is also zero', () => {
    expect(counterAdvanced(0, 0)).toBe(true);
  });
});

describe('passkeyAuthenticationOptions', () => {
  it('[WEBAUTHN2-7.2.1-01] names no credentials, so a browser offers every discoverable one it holds', async () => {
    const { options, challenge } = await passkeyAuthenticationOptions(PUBLIC_BASE_URL);

    expect(options.rpId).toBe(RP_ID);
    expect(options.allowCredentials).toBeUndefined();
    expect(options.userVerification).toBe('required');
    expect(options.challenge).toBe(challenge);
  });
});
