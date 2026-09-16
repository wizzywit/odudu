import { randomBytes } from 'node:crypto';
import { uuidv7 } from 'uuidv7';

export function newId(): string {
  return uuidv7();
}

// Every id this server hands out goes into a `uuid` column, and Postgres
// raises `invalid input syntax for type uuid` on anything else rather than
// matching no row. A value that arrived from outside — a form field, a
// query parameter, a cookie — is checked for shape before it reaches a
// comparison against one of those columns, or an unauthenticated client
// decides what gets logged as a server fault.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Any version and any variant, not just the v7 newId mints: what matters is
// whether Postgres can parse it.
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

// A page that has to run a script of its own gets a nonce its Content
// Security Policy names, rather than 'unsafe-inline' (ADR 0018's
// amendment). Fresh per response: a nonce a second page could predict is a
// nonce injected markup can carry.
export function scriptNonce(): string {
  return randomBytes(16).toString('base64');
}
