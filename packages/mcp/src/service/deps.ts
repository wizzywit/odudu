import type { MintAgentTokenInput } from '@odudu/protocol-oidc';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import type { RequestScope } from '#/service/request-scope';
import type { ValidatedMcpToken } from '#/service/validated-token';

export interface McpLogger {
  debug(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

// What the server hands the MCP layer, once per process. The layer holds no
// database or signing key: minting runs where those are, behind `mintAgentToken`.
export interface McpDeps {
  // Signs the admin-audience token an agent acts with, for the owner whose
  // grant `token` names.
  mintAgentToken(
    token: ValidatedMcpToken,
    input: MintAgentTokenInput,
  ): Promise<{ accessToken: string; expiresAt: Date }>;
  // The app's own `inject`: an admin call never leaves the process.
  inject(options: InjectOptions): Promise<LightMyRequestResponse>;
  readonly now: () => Date;
  readonly adminAudience: string;
  // The host the admin API is addressed at. Left out, the issuer's own host.
  readonly adminHost?: string | undefined;
  readonly logger: McpLogger;
}

// The deps plus what lives for one request.
export interface McpCallDeps extends McpDeps {
  readonly request: RequestScope;
}
