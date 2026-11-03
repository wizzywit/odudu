import type { CountResponse, Settings, SigningKey, SmtpConfig } from '@odudu/contracts/admin';
import type { AuditEvent } from '#/entities/audit-event';
import type { Place } from '#/entities/area';
import type { Read } from '#/shared/lib/services/read';

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

// One of the page's reads: `off` is one it did not make, because whoami has
// not answered or says the capability it needs is not held.
export type OverviewRead<T> = { status: 'off' } | Read<T>;

// A read the page may not make at all, because whoami says the capability
// it needs is not held.
export type Gated<T> = OverviewRead<T> | { status: 'needs'; capability: string };

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
  discovery: OverviewRead<Discovery>;
  jwks: OverviewRead<Jwks>;
  counts: Readonly<Record<Collection, OverviewRead<CountResponse>>>;
  settings: OverviewRead<Settings>;
  smtp: OverviewRead<SmtpConfig>;
  keys: OverviewRead<readonly SigningKey[]>;
  audit: OverviewRead<readonly AuditEvent[]>;
}

export type AreaOf = (path: string) => Place;
