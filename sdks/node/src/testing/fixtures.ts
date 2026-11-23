import { readFileSync } from 'node:fs';
import type { JWK } from 'jose';

export interface FixtureCase {
  name: string;
  token: string;
  issuer: string;
  audience: string;
  requiredScope?: string;
  now: number;
  expected:
    { ok: true; scope: string[] } | { ok: false; status: 401 | 403; code: string; reason: string };
}

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), 'utf8'));

export const fixtureCases = (): FixtureCase[] => read('cases.json') as FixtureCase[];
export const fixtureJwks = (): { keys: JWK[] } => read('jwks.json') as { keys: JWK[] };

export function fixtureCase(name: string): FixtureCase {
  const found = fixtureCases().find((c) => c.name === name);
  if (found === undefined) throw new Error(`no fixture case named ${name}`);
  return found;
}

export interface FixtureFetch {
  fetch: typeof fetch;
  requests: string[];
}

// Answers an issuer's discovery document and its JWK Set without a socket, so
// a fixture's issuer can be a name that does not resolve.
export function fixtureFetch(issuer: string, jwks: { keys: JWK[] } = fixtureJwks()): FixtureFetch {
  const requests: string[] = [];
  const respond: typeof fetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Promise.resolve(Response.json({ issuer, jwks_uri: `${issuer}/jwks` }));
    }
    if (url === `${issuer}/jwks`) return Promise.resolve(Response.json(jwks));
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
  return { fetch: respond, requests };
}
