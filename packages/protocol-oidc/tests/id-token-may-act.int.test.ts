import type { ClaimMapperRegistry } from '@odudu/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { standardClaimMappers, type ClaimContext } from '#/service/claims';
import {
  addClient,
  decode,
  exchange,
  login,
  startAgentStack,
  type AgentStack,
} from '#/testing/agent-fixture';

const OWNER_CLIENT = 'owner-client';
const OPEN_OWNER = 'open-owner-client';
const PERMITTED = 'permitted-actor';
const ID_TOKEN = 'urn:ietf:params:oauth:token-type:id_token';

let stack: AgentStack;

beforeAll(async () => {
  const mappers: ClaimMapperRegistry<ClaimContext> = standardClaimMappers();
  mappers.register({
    name: 'forged-may-act',
    scopes: ['openid'],
    claims: ['may_act'],
    map: () => Promise.resolve({ may_act: { sub: 'attacker', iss: 'https://attacker.example' } }),
  });
  stack = await startAgentStack({ claimMappers: mappers });
  await addClient(stack, { clientId: OWNER_CLIENT, delegatedActors: [PERMITTED] });
  await addClient(stack, { clientId: OPEN_OWNER, impersonation: true });
  await addClient(stack, { clientId: PERMITTED, impersonation: true });
}, 120_000);

afterAll(async () => {
  await stack.stop();
});

async function idTokenFor(clientId: string, subjectToken: string): Promise<string> {
  const res = await exchange(stack, clientId, subjectToken, {
    scope: 'openid',
    extra: { requested_token_type: ID_TOKEN },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ access_token: string }>().access_token;
}

describe('an ID token minted by an exchange', () => {
  it('carries the may_act of the token it was made from', async () => {
    const owner = await login(stack, OWNER_CLIENT);
    const idToken = await idTokenFor(PERMITTED, owner.accessToken);
    expect(decode(idToken).may_act).toEqual(decode(owner.accessToken).may_act);
  });

  it('is refused when exchanged again with an actor token the claim does not name', async () => {
    const owner = await login(stack, OWNER_CLIENT);
    const idToken = await idTokenFor(PERMITTED, owner.accessToken);
    const actor = await login(stack, PERMITTED);
    const res = await exchange(stack, PERMITTED, idToken, {
      scope: 'openid',
      extra: {
        subject_token_type: ID_TOKEN,
        actor_token: actor.accessToken,
        actor_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('invalid_request');
  });

  it('drops a may_act a claim mapper supplies', async () => {
    const owner = await login(stack, OPEN_OWNER);
    expect(decode(await idTokenFor(PERMITTED, owner.accessToken)).may_act).toBeUndefined();
  });
});
