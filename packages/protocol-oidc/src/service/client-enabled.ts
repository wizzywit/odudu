// The one door a disabled client's live tokens still had open: `/userinfo`,
// `/introspect` and token exchange each already check the token's grant and
// its session, but none of the three read `clients.enabled`. One predicate,
// wired at all five call sites (userinfo.ts; introspection.ts;
// token-exchange-subject.ts's access-token, refresh-token and id_token
// branches), closes it uniformly — five inline reads would pass the same
// tests and is how the blind spot arose in the first place.
export interface LiveClient {
  readonly enabled: boolean;
}

export function clientIsLive(client: LiveClient | null): boolean {
  return client?.enabled ?? false;
}

// Tenant-scoped, and keyed by the OAuth `client_id` string every token
// carries — never the clients table's surrogate id, which no token names.
export interface LiveClientLookup {
  findLiveClient(tenantId: string, oauthClientId: string): Promise<LiveClient | null>;
}
