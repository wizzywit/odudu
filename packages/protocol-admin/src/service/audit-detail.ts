// Per-resource-type allowlist: a field here is 'value' (diffed by value) or
// 'sensitive' (diffed as `{ changed: true }`, never its actual value). A
// field on neither list is omitted — the default is silence, not
// disclosure, so a column added later is absent from the audit rather than
// printed into it.
type FieldSensitivity = 'value' | 'sensitive';
type ResourceAllowlist = Record<string, FieldSensitivity>;

const ALLOWLISTS: Record<string, ResourceAllowlist> = {
  client: {
    name: 'value',
    enabled: 'value',
    type: 'value',
    full_scope_allowed: 'value',
    redirect_uris: 'value',
    grant_types: 'value',
    token_endpoint_auth_method: 'value',
    audiences: 'value',
    access_token_ttl_seconds: 'value',
    refresh_token_ttl_seconds: 'value',
    client_credentials_scopes: 'value',
    web_origins: 'value',
    post_logout_redirect_uris: 'value',
    jwks_uri: 'value',
    frontchannel_logout_uri: 'value',
    backchannel_logout_uri: 'value',
    // `jwks` reaches here through `clientWireShape` and can really change
    // on an amend. `secret_hash` and `password_encrypted` cannot: neither
    // is ever part of a client's wire shape, and `rotateClientSecret`
    // records its own detail without calling this function at all. Both
    // stay marked sensitive anyway, on the same reasoning as omit-by-default
    // — a wire shape that starts including one later must not start
    // leaking it just because nobody updated an allowlist.
    secret_hash: 'sensitive',
    password_encrypted: 'sensitive',
    jwks: 'sensitive',
  },
  tenant: {
    name: 'value',
    display_name: 'value',
    enabled: 'value',
  },
  group: {
    name: 'value',
    parent_id: 'value',
  },
  role: {
    name: 'value',
  },
  scope: {
    name: 'value',
  },
  signing_key: {
    status: 'value',
    private_jwk_encrypted: 'sensitive',
  },
  subject: {
    username: 'value',
    email: 'value',
    enabled: 'value',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOf(record: Record<string, unknown> | null, field: string): unknown {
  return record === null ? undefined : record[field];
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * `before`/`after` are the resource's own wire shape, not its database row —
 * see each usecase's own `*WireShape` function. Neither argument is trusted
 * to be an object: a `null` (nothing existed yet, or nothing survived) reads
 * every field as `undefined`.
 */
export function redactedDiff(
  resourceType: string,
  before: unknown,
  after: unknown,
): Record<string, unknown> {
  const allowlist = ALLOWLISTS[resourceType] ?? {};
  const beforeRecord = isRecord(before) ? before : null;
  const afterRecord = isRecord(after) ? after : null;

  const diff: Record<string, unknown> = {};
  for (const [field, sensitivity] of Object.entries(allowlist)) {
    const beforeValue = fieldOf(beforeRecord, field);
    const afterValue = fieldOf(afterRecord, field);
    if (!valuesDiffer(beforeValue, afterValue)) continue;
    diff[field] =
      sensitivity === 'sensitive' ? { changed: true } : { before: beforeValue, after: afterValue };
  }
  return diff;
}
