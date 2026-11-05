import { type CimdClient } from '#/service/client-id-metadata';

const LAST_USED_GRANULARITY_MS = 24 * 60 * 60 * 1000;

export type CimdClientType = 'public' | 'confidential';

export function cimdClientType(document: CimdClient): CimdClientType {
  return document.tokenEndpointAuthMethod === 'none' ? 'public' : 'confidential';
}

// What to do with a resolved document given what the tenant already holds: a
// client of another origin under that id is never touched, a client of this
// origin is rewritten, and a new one is created while the tenant is under its
// ceiling, else it must make room.
export type CimdPlacement = 'foreign' | 'amend' | 'create' | 'make_room';

export function placementOf(
  existingOrigin: string | null,
  held: number,
  ceiling: number,
): CimdPlacement {
  if (existingOrigin !== null) return existingOrigin === 'cimd' ? 'amend' : 'foreign';
  return held >= ceiling ? 'make_room' : 'create';
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface StoredCimdClient {
  readonly name: string;
  readonly type: CimdClientType;
  readonly metadataUsedAt: Date | null;
}

export interface StoredCimdConfig {
  readonly redirectUris: readonly string[];
  readonly tokenEndpointAuthMethod: string;
  readonly jwks: unknown;
  readonly jwksUri: string | null;
}

export interface CimdAmendment {
  readonly client: { readonly name: string; readonly type: CimdClientType } | null;
  // 'create' when the client has no configuration row at all.
  readonly config:
    | 'create'
    | {
        readonly redirectUris: string[];
        readonly tokenEndpointAuthMethod: CimdClient['tokenEndpointAuthMethod'];
        readonly jwks: CimdClient['jwks'];
        readonly jwksUri: string | null;
      }
    | null;
  readonly touch: boolean;
}

// Only what differs is written, and the last-use instant at most once a day,
// so resolving a document a hundred times an hour costs reads, not writes.
export function amendmentOf(
  stored: StoredCimdClient,
  config: StoredCimdConfig | null,
  document: CimdClient,
  now: Date,
): CimdAmendment {
  const type = cimdClientType(document);
  const configChanged =
    config !== null &&
    (!sameList(config.redirectUris, document.redirectUris) ||
      config.tokenEndpointAuthMethod !== document.tokenEndpointAuthMethod ||
      !sameJson(config.jwks, document.jwks) ||
      config.jwksUri !== document.jwksUri);
  return {
    client:
      stored.name !== document.clientName || stored.type !== type
        ? { name: document.clientName, type }
        : null,
    config:
      config === null
        ? 'create'
        : configChanged
          ? {
              redirectUris: document.redirectUris,
              tokenEndpointAuthMethod: document.tokenEndpointAuthMethod,
              jwks: document.jwks,
              jwksUri: document.jwksUri,
            }
          : null,
    touch:
      stored.metadataUsedAt === null ||
      now.getTime() - stored.metadataUsedAt.getTime() >= LAST_USED_GRANULARITY_MS,
  };
}
