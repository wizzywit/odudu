export interface VerifierOptions {
  // The issuers whose tokens the API accepts. A token's `iss` must equal one
  // exactly, and keys are fetched for these issuers only.
  issuers: string[];
  // What this API is called in a token's `aud`.
  audience: string;
  // A scope every accepted token must carry; its absence is a 403.
  requiredScope?: string;
  // How long an issuer's discovery document and keys are kept. Default 300 000.
  jwksTtlMs?: number;
  // Milliseconds since the epoch. Default `Date.now`.
  clock?: () => number;
  fetch?: typeof fetch;
  // Accept issuers that are not `https` (a development server on loopback).
  // Default false.
  allowInsecureIssuers?: boolean;
}

export interface VerifiedToken {
  sub: string;
  clientId: string | undefined;
  scope: string[];
  audience: string[];
  claims: Record<string, unknown>;
}

// What `createVerifier` returns, and what the middleware takes.
export type Verifier = (token: string) => Promise<VerifiedToken>;
