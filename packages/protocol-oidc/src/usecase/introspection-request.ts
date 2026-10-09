import { type TenantScopedDatabase } from '@odudu/db';
import { readOptionalField } from '#/usecase/client-authentication';
import {
  authenticateEndpointClient,
  type ClientRequest,
  type EndpointAuthenticationDeps,
} from '#/usecase/private-key-jwt-authentication';
import {
  introspect,
  type IntrospectionDeps,
  type IntrospectionResponse,
} from '#/usecase/introspection';

export interface IntrospectionRequestDeps extends IntrospectionDeps, EndpointAuthenticationDeps {}

// The one orchestration step ahead of `introspect` itself: authenticate the
// caller the same way `/token` does (`authenticateEndpointClient`,
// `#/usecase/private-key-jwt-authentication.ts`), then hand its identity to the pure
// decision. A failure to authenticate throws — the same `TokenError`/
// `TokenRateLimited` `/token` throws — because "who is calling" is not a
// question `introspect` answers; everything past that point is `{ active:
// ... }`, never an error.
export async function respondToIntrospectionRequest(
  tx: TenantScopedDatabase,
  deps: IntrospectionRequestDeps,
  request: ClientRequest,
  now: Date,
): Promise<IntrospectionResponse> {
  const { body } = request;
  const { client, config } = await authenticateEndpointClient(tx, deps, request);

  const token = readOptionalField(body, 'token') ?? '';
  return introspect(
    deps,
    { token, caller: { clientId: client.clientId, audiences: config.audiences } },
    now,
  );
}
