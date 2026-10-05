import type {
  AuditEvent,
  CountResponse,
  Settings,
  SigningKey,
  SmtpConfig,
} from '@odudu/contracts/admin';
import { holds, readable } from '#/shared/service/access.ts';
import { isRefused } from '#/shared/service/failure.ts';
import { readyToPromote } from '#/shared/service/keyPromotion.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import type { GatewayResult } from '#/shared/service/result.ts';

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

export type Collection = 'subjects' | 'clients' | 'groups' | 'roles' | 'scopes';

export interface OverviewAsks {
  discovery: boolean;
  subjects: boolean;
  clients: boolean;
  groups: boolean;
  roles: boolean;
  scopes: boolean;
  settings: boolean;
  smtp: boolean;
  keys: boolean;
  audit: boolean;
}

export type ReadName = keyof OverviewAsks | 'jwks';

export interface OverviewReads {
  discovery: Read<Discovery>;
  jwks: Read<Jwks>;
  counts: Readonly<Record<Collection, Read<CountResponse>>>;
  settings: Read<Settings>;
  smtp: Read<SmtpConfig>;
  keys: Read<readonly SigningKey[]>;
  audit: Read<readonly AuditEvent[]>;
}

// What an area is called, needs and is addressed by; the overview links to
// areas it does not own.
export interface Place {
  label: string;
  capability: AdminCapability | null;
  href: string;
}

export type AreaOf = (path: string) => Place;

export function readOutcome<T>(
  asked: boolean,
  result: GatewayResult<T> | undefined,
  retry: () => void,
): Read<T> {
  if (!asked) return { status: 'off' };
  if (result === undefined) return { status: 'loading' };
  if (result.ok) return { status: 'ready', data: result.data };
  return { status: 'failed', refused: isRefused(result), retry };
}

export function mapRead<T, U>(read: Read<T>, map: (data: T) => U): Read<U> {
  return read.status === 'ready' ? { status: 'ready', data: map(read.data) } : read;
}

export function readyData<T>(read: Read<T>): T | undefined {
  return read.status === 'ready' ? read.data : undefined;
}

// Before whoami answers a read is `off` and shows as loading; after, one
// whose capability is not held, or that the server refused, names it.
export function gate<T>(
  read: Read<T>,
  authority: Authority | undefined,
  capability: AdminCapability | null,
): Gated<T> {
  if (capability === null) return read;
  const refused = read.status === 'failed' && read.refused;
  if ((authority !== undefined && !holds(authority, capability)) || refused) {
    return { status: 'needs', capability };
  }
  return read;
}

// What each read needs; the tenant's public documents need no capability.
const NEEDS: Readonly<Record<ReadName, AdminCapability | null>> = {
  discovery: null,
  jwks: null,
  subjects: 'view-users',
  clients: 'manage-clients',
  groups: 'manage-tenant',
  roles: 'manage-tenant',
  scopes: 'manage-tenant',
  settings: 'manage-tenant',
  smtp: 'manage-tenant',
  keys: 'manage-keys',
  audit: 'view-audit',
};

export function readCapability(name: ReadName): AdminCapability | null {
  return NEEDS[name];
}

// A read the capability allows, once whoami has said what is held; the
// public documents are asked for as soon as the tenant is known to exist.
export function overviewAsks(
  authority: Authority | undefined,
  tenantMissing: boolean | undefined,
): OverviewAsks {
  const has = (name: ReadName): boolean => {
    const capability = NEEDS[name];
    return authority !== undefined && capability !== null && holds(authority, capability);
  };
  return {
    discovery: tenantMissing === false,
    subjects: has('subjects'),
    clients: has('clients'),
    groups: has('groups'),
    roles: has('roles'),
    scopes: has('scopes'),
    settings: has('settings'),
    smtp: has('smtp'),
    keys: has('keys'),
    audit: has('audit'),
  };
}

export function keysView(reads: OverviewReads, authority: Authority | undefined): Read<KeysView> {
  const keys = gate(reads.keys, authority, 'manage-keys');
  const listed = keys.status === 'ready' ? keys.data : undefined;
  return mapRead(reads.jwks, (jwks) => ({
    rows: publishedKeys(jwks, listed),
    raw: rawJson(jwks),
    lanesNeed: keys.status === 'needs' ? keys.capability : null,
  }));
}

const COUNTED = [
  { id: 'subjects', noun: { one: 'subject', other: 'subjects' } },
  { id: 'clients', noun: { one: 'client', other: 'clients' } },
  { id: 'groups', noun: { one: 'group', other: 'groups' } },
  { id: 'roles', noun: { one: 'role', other: 'roles' } },
  { id: 'scopes', noun: { one: 'scope', other: 'scopes' } },
] as const;

// A tile links to its area, so one the rail leaves out is left out here.
export function countTiles(
  reads: OverviewReads,
  authority: Authority | undefined,
  areaOf: AreaOf,
): CountTile[] {
  const cap = readyData(reads.settings)?.max_clients;
  return COUNTED.flatMap(({ id, noun }) => {
    const place = areaOf(id);
    if (!readable(authority, place.capability)) return [];
    return [
      {
        id,
        label: place.label,
        href: place.href,
        noun,
        count: gate(reads.counts[id], authority, place.capability),
        limit: id === 'clients' && typeof cap === 'number' ? cap : undefined,
      },
    ];
  });
}

export interface AttentionData extends Omit<AttentionState, 'retry'> {
  // Asks again for each read that failed.
  retries: readonly (() => void)[];
}

// The attention checks read settings and the SMTP relay, the signing keys,
// and the client count.
const CHECKED_WITH: readonly AdminCapability[] = ['manage-tenant', 'manage-keys', 'manage-clients'];

export function attentionState(
  reads: OverviewReads,
  authority: Authority | undefined,
  areaOf: AreaOf,
  now: Date,
): AttentionData {
  const used = [reads.settings, reads.smtp, reads.keys, reads.counts.clients];
  const unchecked = authority === undefined ? [] : CHECKED_WITH.filter((c) => !holds(authority, c));
  const retries = used.flatMap((read) => (read.status === 'failed' ? [read.retry] : []));
  const items = needsAttention({
    settings: readyData(reads.settings),
    smtp: readyData(reads.smtp),
    keys: readyData(reads.keys),
    clients: readyData(reads.counts.clients),
    now,
  }).map((item) => {
    const place = areaOf(item.area);
    return { ...item, href: place.href, place: place.label };
  });
  return {
    status:
      authority === undefined || used.some((read) => read.status === 'loading')
        ? 'checking'
        : 'ready',
    items,
    unchecked,
    failed: retries.length > 0,
    retries,
  };
}

export function isClear(attention: Omit<AttentionState, 'retry'>): boolean {
  return (
    attention.status === 'ready' &&
    attention.items.length === 0 &&
    attention.unchecked.length === 0 &&
    !attention.failed
  );
}

// The latest audit rows are left off the page when the area is not the
// caller's to read.
export function auditView(
  access: { kind: 'hidden' | 'checking' | 'refused' | 'open' },
  audit: Read<readonly AuditEvent[]>,
  authority: Authority | undefined,
): Gated<readonly AuditEvent[]> | null {
  return access.kind === 'refused' ? null : gate(audit, authority, 'view-audit');
}

export function laneText(lane: KeyLane): string {
  return lane === 'unlisted' ? 'not in the key list' : lane;
}

export function unreadableTitle(what: string): string {
  return `The ${what} could not be read`;
}

const NUMBER = new Intl.NumberFormat('en');

export function limitText(limit: number): string {
  return ` of ${NUMBER.format(limit)} allowed`;
}

export function countAgainLabel(noun: string): string {
  return `Count ${noun} again`;
}

export function openPlaceLabel(place: string): string {
  return `Open ${place}`;
}

export const UNCHECKED_LEAD = 'Some checks need a capability you do not hold: ';
