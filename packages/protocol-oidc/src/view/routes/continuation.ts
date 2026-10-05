import { type PendingRequest } from '@odudu/authn-flows';
import { type RenderedPage } from '@odudu/kernel';

export interface ContinuationDeps {
  findTenant(name: string): Promise<{ id: string } | null>;
  loadPendingRequest(tenantId: string, authSessionId: string): Promise<PendingRequest | null>;
}

// A page whose form continues a parked authorization request can be answered
// with a 302 to that request's client, so it names the client's redirect_uri
// for `pageHeaders` to license (ADR 0018). The value is the one /authorize
// validated and parked, never anything the browser submitted.
export async function continuing(
  deps: ContinuationDeps,
  tenantName: string,
  authSessionId: string,
  page: RenderedPage,
): Promise<RenderedPage> {
  const tenant = await deps.findTenant(tenantName);
  const pending = tenant === null ? null : await deps.loadPendingRequest(tenant.id, authSessionId);
  return pending === null ? page : { ...page, redirectsTo: pending.redirectUri };
}
