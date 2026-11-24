import { createHash, randomBytes } from 'node:crypto';
import { containsBidiControl } from '@odudu/contracts';

export const CIBA_GRANT = 'urn:openid:params:grant-type:ciba';

// OpenID CIBA §7.3: what a client waits between polls when told nothing else.
export const CIBA_INTERVAL_SECONDS = 5;
export const BINDING_MESSAGE_MAX_LENGTH = 140;
// What one client may hold, unexpired, for one hint.
export const LIVE_REQUESTS_PER_HINT = 20;
const LOGIN_HINT_MAX_LENGTH = 512;
const ID_TOKEN_HINT_MAX_LENGTH = 8192;
const SCOPE_MAX_LENGTH = 1024;
// requested_expiry is an integer of seconds; a value past this is not a lifetime anybody meant.
const REQUESTED_EXPIRY_MAX = 2_147_483_647;

// Parameters that would change what the OP does and that it does not
// implement: refused, never ignored (docs/protocols/oidc-ciba.md).
const UNSUPPORTED_PARAMETERS = [
  'user_code',
  'client_notification_token',
  'login_hint_token',
  'request',
  'request_uri',
] as const;

export type BackchannelRefusal = 'invalid_request' | 'invalid_scope' | 'invalid_binding_message';

export interface BackchannelRequest {
  readonly scope: string;
  readonly hint: {
    readonly kind: 'login_hint' | 'id_token_hint';
    readonly value: string;
  };
  // The validated text as written; whatever shows it escapes it.
  readonly bindingMessage: string | null;
  readonly requestedExpiry: number | null;
}

export type BackchannelParse =
  | { readonly ok: true; readonly request: BackchannelRequest }
  | {
      readonly ok: false;
      readonly error: BackchannelRefusal;
    };

type Body = Record<string, string | string[] | undefined>;

const refuse = (error: BackchannelRefusal): BackchannelParse => ({ ok: false, error });

// RFC 6749 §3.2: a parameter sent empty is read as absent. A repeated one is
// reported as such, for the caller to refuse.
function single(body: Body, key: string): { text: string | undefined; repeated: boolean } {
  const value = body[key];
  if (Array.isArray(value)) return { text: undefined, repeated: true };
  return {
    text: typeof value === 'string' && value.length > 0 ? value : undefined,
    repeated: false,
  };
}

// Control and format characters, which include the line and paragraph separators.
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

// What a login hint refuses: control characters, line and paragraph separators and
// the bidirectional overrides and isolates a username may not hold. Other format
// characters, the zero-width joiners some scripts need, a username may hold.
const hintIsRefused = (value: string): boolean =>
  /[\p{Cc}\p{Zl}\p{Zp}]/u.test(value) || containsBidiControl(value);

export function parseBackchannelRequest(body: Body): BackchannelParse {
  if (UNSUPPORTED_PARAMETERS.some((name) => single(body, name).text !== undefined)) {
    return refuse('invalid_request');
  }

  const read = ['scope', 'login_hint', 'id_token_hint', 'binding_message', 'requested_expiry'].map(
    (name) => single(body, name),
  );
  if (read.some((each) => each.repeated)) return refuse('invalid_request');
  const [scope, loginHint, idTokenHint, binding, expiry] = read.map((each) => each.text);

  if (loginHint !== undefined && idTokenHint !== undefined) return refuse('invalid_request');
  const hint =
    loginHint !== undefined
      ? ({ kind: 'login_hint', value: loginHint } as const)
      : idTokenHint !== undefined
        ? ({ kind: 'id_token_hint', value: idTokenHint } as const)
        : undefined;
  if (hint === undefined) return refuse('invalid_request');
  const longest = hint.kind === 'login_hint' ? LOGIN_HINT_MAX_LENGTH : ID_TOKEN_HINT_MAX_LENGTH;
  if (hint.value.length > longest || hintIsRefused(hint.value)) {
    return refuse('invalid_request');
  }

  if (scope === undefined || scope.length > SCOPE_MAX_LENGTH) return refuse('invalid_scope');
  if (!scope.split(' ').includes('openid')) return refuse('invalid_scope');

  let bindingMessage: string | null = null;
  if (binding !== undefined) {
    if (
      Array.from(binding).length > BINDING_MESSAGE_MAX_LENGTH ||
      CONTROL_CHARACTER.test(binding)
    ) {
      return refuse('invalid_binding_message');
    }
    bindingMessage = binding;
  }

  let requestedExpiry: number | null = null;
  if (expiry !== undefined) {
    if (!/^[0-9]+$/u.test(expiry)) return refuse('invalid_request');
    const seconds = Number(expiry);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > REQUESTED_EXPIRY_MAX) {
      return refuse('invalid_request');
    }
    requestedExpiry = seconds;
  }

  return { ok: true, request: { scope, hint, bindingMessage, requestedExpiry } };
}

// 256 random bits in the characters §7.3 allows, which base64url is a subset of.
export function generateAuthReqId(): string {
  return randomBytes(32).toString('base64url');
}

export function hashAuthReqId(authReqId: string): string {
  return createHash('sha256').update(authReqId).digest('hex');
}

// What the limit on requests for one hint counts against: the hint within its
// tenant, held only as a digest. An address is folded to lower case, as the
// sign-in lookup compares it, so its spellings share one counter whether or not
// anyone holds it; a username is compared exactly.
export function hintDigest(tenantId: string, hint: string): string {
  const folded = hint.includes('@') ? hint.toLowerCase() : hint;
  return createHash('sha256').update(`ciba-hint\0${tenantId}\0${folded}`).digest('hex');
}
