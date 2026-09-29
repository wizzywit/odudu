import type { CountResponse, Settings, SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { readyToPromote } from '#/shared/service/keyPromotion.ts';

export interface Discovery {
  readonly issuer: string;
  readonly [member: string]: unknown;
}

export interface PublicKey {
  readonly kty: string;
  readonly kid?: string | undefined;
  readonly alg?: string | undefined;
  readonly use?: string | undefined;
  readonly [member: string]: unknown;
}

export interface Jwks {
  readonly keys: readonly PublicKey[];
  readonly [member: string]: unknown;
}

export interface DiscoveryView {
  readonly issuer: string;
  readonly endpoints: readonly { readonly name: string; readonly url: string }[];
  readonly lists: readonly { readonly name: string; readonly values: readonly string[] }[];
  readonly flags: readonly { readonly name: string; readonly value: boolean }[];
}

function isEndpoint(name: string): boolean {
  return name.endsWith('_endpoint') || name === 'jwks_uri';
}

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function discoveryView(document: Discovery): DiscoveryView {
  const members = Object.entries(document);
  return {
    issuer: document.issuer,
    endpoints: members.flatMap(([name, value]) =>
      isEndpoint(name) && typeof value === 'string' ? [{ name, url: value }] : [],
    ),
    lists: members.flatMap(([name, value]) =>
      name.endsWith('_supported') && isStrings(value) ? [{ name, values: value }] : [],
    ),
    flags: members.flatMap(([name, value]) =>
      name.endsWith('_supported') && typeof value === 'boolean' ? [{ name, value }] : [],
    ),
  };
}

// `unlisted` is published but absent from the key list; `unknown` is a list
// that could not be read.
export type KeyLane = SigningKey['status'] | 'unlisted' | 'unknown';

export interface PublishedKey {
  readonly kid: string | null;
  readonly kty: string;
  readonly alg: string | null;
  readonly use: string | null;
  readonly lane: KeyLane;
}

export function publishedKeys(
  jwks: Jwks,
  keys: readonly SigningKey[] | undefined,
): readonly PublishedKey[] {
  return jwks.keys.map((key) => {
    const kid = key.kid ?? null;
    const listed = keys?.find((k) => k.kid === kid);
    let lane: KeyLane = 'unknown';
    if (keys !== undefined) lane = listed?.status ?? 'unlisted';
    return { kid, kty: key.kty, alg: key.alg ?? null, use: key.use ?? null, lane };
  });
}

export interface AttentionItem {
  readonly id: string;
  // The area whose page fixes it.
  readonly area: 'email' | 'keys' | 'settings';
  readonly title: string;
  readonly detail: string;
}

// A read that is undefined was not made or not answered, and the checks
// that need it are skipped rather than guessed.
export interface AttentionInputs {
  readonly settings: Settings | undefined;
  readonly smtp: SmtpConfig | undefined;
  readonly keys: readonly SigningKey[] | undefined;
  readonly clients: CountResponse | undefined;
  readonly now: Date;
}

function mailNeeds(settings: Settings): string | null {
  const needs = [
    settings.verify_email === true ? 'email verification' : null,
    settings.reset_password_allowed === true ? 'password reset' : null,
  ].filter((need) => need !== null);
  return needs.length === 0 ? null : needs.join(' and ');
}

function mail(settings: Settings | undefined, smtp: SmtpConfig | undefined): AttentionItem[] {
  if (settings === undefined || smtp?.effective !== 'none') return [];
  const needs = mailNeeds(settings);
  if (needs === null) return [];
  return [
    {
      id: 'smtp',
      area: 'email',
      title: 'No mail relay',
      detail: `This tenant has ${needs} on, but neither it nor the deployment has an SMTP relay, so that mail is only logged.`,
    },
  ];
}

function promotions(keys: readonly SigningKey[] | undefined, now: Date): AttentionItem[] {
  return (keys === undefined ? [] : readyToPromote(keys, now)).map((key) => ({
    id: `key:${key.id}`,
    area: 'keys',
    title: 'A signing key is ready to promote',
    detail: `The ${key.alg} key ${key.kid} has been published longer than any token lives, so relying parties can verify what it signs.`,
  }));
}

// A capped count is a floor: it decides "full" only when the cap is at or
// below the count it stopped at.
function registration(
  settings: Settings | undefined,
  clients: CountResponse | undefined,
): AttentionItem[] {
  if (settings === undefined || clients === undefined) return [];
  const policy = settings.client_registration_policy;
  const cap = settings.max_clients;
  if ((policy !== 'open' && policy !== 'token') || typeof cap !== 'number') return [];
  if (clients.count < cap) return [];
  const how = policy === 'open' ? 'open to anyone' : 'open with a registration token';
  return [
    {
      id: 'registration',
      area: 'settings',
      title: 'Dynamic registration has no room left',
      detail: `Registration is ${how}, but the tenant already holds its limit of ${String(cap)} clients, so every registration is refused.`,
    },
  ];
}

export function needsAttention(inputs: AttentionInputs): readonly AttentionItem[] {
  return [
    ...mail(inputs.settings, inputs.smtp),
    ...promotions(inputs.keys, inputs.now),
    ...registration(inputs.settings, inputs.clients),
  ];
}

// One of the page's reads: `off` is one it did not make, because whoami has
// not answered or says the capability it needs is not held.
export type Read<T> =
  | { readonly status: 'off' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'failed'; readonly refused: boolean; readonly retry: () => void };
