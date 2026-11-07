import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type ValidatedMcpToken } from '#/service/validated-token';

// What the route knows of the principal once a token has been validated.
export interface McpPrincipal {
  readonly token: ValidatedMcpToken;
  // The database id of the agent's client row, which audit rows name.
  readonly clientDbId: string;
}

// One authenticated request's way of being served. It holds what lives for
// that request alone (its admin bearers, its capability lookup) and nothing a
// later request could see.
export interface McpExchange {
  serve(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void>;
}

export interface McpRequestInfo {
  // Generated here for this request, never taken from a header the caller sent.
  readonly requestId: string;
  readonly ip: string;
}

export type OpenExchange = (principal: McpPrincipal, request: McpRequestInfo) => McpExchange;
