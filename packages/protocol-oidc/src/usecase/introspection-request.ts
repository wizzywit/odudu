import { type TenantScopedDatabase } from '@odudu/db';
import {
  authenticateClient,
  parseBasicAuth,
  readOptionalField,
  type ClientAuthenticationDeps,
} from '#/usecase/client-authentication';
import {
  introspect,
  type IntrospectionDeps,
  type IntrospectionResponse,
} from '#/usecase/introspection';

export interface IntrospectionRequestDeps extends IntrospectionDeps, ClientAuthenticationDeps {}

// The one orchestration step ahead of `introspect` itself: authenticate the
// caller the same way `/token` does (`authenticateClient`,
// `#/usecase/client-authentication.ts`), then hand its identity to the pure
// decision. A failure to authenticate throws — the same `TokenError`/
// `TokenRateLimited` `/token` throws — because "who is calling" is not a
// question `introspect` answers; everything past that point is `{ active:
// ... }`, never an error.
export async function respondToIntrospectionRequest(
  tx: TenantScopedDatabase,
  deps: IntrospectionRequestDeps,
  body: Record<string, string | string[] | undefined>,
  authorizationHeader: string | undefined,
  now: Date,
): Promise<IntrospectionResponse> {
  const basic = parseBasicAuth(authorizationHeader);
  const { client, config } = await authenticateClient(
    tx,
    deps,
    basic,
    readOptionalField(body, 'client_id'),
    readOptionalField(body, 'client_secret'),
  );

  const token = readOptionalField(body, 'token') ?? '';
  return introspect(
    deps,
    { token, caller: { clientId: client.clientId, audiences: config.audiences } },
    now,
  );
}
