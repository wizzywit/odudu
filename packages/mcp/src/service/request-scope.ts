export interface AdminBearer {
  readonly bearer: string;
  readonly expiresAt: Date;
}

// What lives for exactly one MCP request: its correlation id, the address it
// came from, and the admin bearers minted during it. The endpoint creates one
// per request and drops it with the request, so no bearer outlives the call
// that needed it or is seen by another principal's request.
export interface RequestScope {
  readonly requestId: string;
  readonly ip: string;
  readonly bearers: Map<string, AdminBearer>;
}

export function newRequestScope(requestId: string, ip: string): RequestScope {
  return { requestId, ip, bearers: new Map() };
}
