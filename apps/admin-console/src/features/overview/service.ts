import type { CountResponse, Settings, SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import { readyToPromote } from '#/shared/service/keyPromotion.ts';

export interface Discovery {
  issuer: string;
  [member: string]: unknown;
}

export interface PublicKey {
  kty: string;
  kid?: string | undefined;
  alg?: string | undefined;
  use?: string | undefined;
  [member: string]: unknown;
}

export interface Jwks {
  keys: readonly PublicKey[];
  [member: string]: unknown;
}

export interface DiscoveryView {
  issuer: string;
  // Where relying parties read it, OpenID Connect Discovery 1.0 §4.
  document: string;
  raw: string;
  endpoints: readonly { name: string; url: string }[];
  lists: readonly { name: string; values: readonly string[] }[];
  flags: readonly { name: string; value: boolean }[];
}

function isEndpoint(name: string): boolean {
  return name.endsWith('_endpoint') || name === 'jwks_uri';
}

function isStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function rawJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function discoveryView(document: Discovery): DiscoveryView {
  const members = Object.entries(document);
  return {
    issuer: document.issuer,
    document: `${document.issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`,
    raw: rawJson(document),
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
  // Its place in the set: a kid is optional, so it cannot key a row.
  row: string;
  kid: string | null;
  kty: string;
  alg: string | null;
  use: string | null;
  lane: KeyLane;
}

export function publishedKeys(
  jwks: Jwks,
  keys: readonly SigningKey[] | undefined,
): readonly PublishedKey[] {
  return jwks.keys.map((key, index) => {
    const kid = key.kid ?? null;
    const listed = keys?.find((k) => k.kid === kid);
    let lane: KeyLane = 'unknown';
    if (keys !== undefined) lane = listed?.status ?? 'unlisted';
    return {
      row: String(index),
      kid,
      kty: key.kty,
      alg: key.alg ?? null,
      use: key.use ?? null,
      lane,
    };
  });
}

export interface AttentionItem {
  id: string;
  // The area whose page fixes it.
  area: 'email' | 'keys' | 'settings';
  title: string;
  detail: string;
}

// A read that is undefined was not made or not answered, and the checks
// that need it are skipped rather than guessed.
export interface AttentionInputs {
  settings: Settings | undefined;
  smtp: SmtpConfig | undefined;
  keys: readonly SigningKey[] | undefined;
  clients: CountResponse | undefined;
  now: Date;
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
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; refused: boolean; retry: () => void };

// A read the page may not make at all, because whoami says the capability
// it needs is not held.
export type Gated<T> = Read<T> | { status: 'needs'; capability: string };

export interface CountTile {
  id: string;
  label: string;
  href: string;
  noun: { one: string; other: string };
  count: Gated<CountResponse>;
  // The client cap, when settings could be read.
  limit?: number | undefined;
}

export interface AttentionLink extends AttentionItem {
  href: string;
  // The label of the area the link opens.
  place: string;
}

export interface AttentionState {
  status: 'checking' | 'ready';
  items: readonly AttentionLink[];
  // Capabilities a check needed and whoami says are not held.
  unchecked: readonly string[];
  failed: boolean;
  retry: () => void;
}

export interface KeysView {
  rows: readonly PublishedKey[];
  raw: string;
  // The capability the keys' lanes need, when it is not held.
  lanesNeed: string | null;
}
