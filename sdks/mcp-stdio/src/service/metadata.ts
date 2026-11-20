import { StdioError } from '#/service/stdio-error';
import type { AddressForm, StdioTarget } from '#/service/stdio-target';

export interface AuthorizationServer {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly issuerAdvertised: boolean;
}

function refuse(reason: string): never {
  throw new StdioError('mcp_discovery_invalid', `the authorization server metadata ${reason}`);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return refuse('is not a JSON object');
  }
  return Object.fromEntries(Object.entries(value));
}

function endpointOf(document: Record<string, unknown>, name: string, origin: string): string {
  const value = document[name];
  if (typeof value !== 'string') return refuse(`has no ${name}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse(`has a ${name} that is not a URL`);
  }
  if (url.origin !== origin) return refuse(`names a ${name} on another origin`);
  return value;
}

// The metadata of the tenant this command was given, or a refusal. The issuer
// must be exactly the address form it was fetched for (base URL plus tenant, or
// the base URL's own origin), and both endpoints must sit on that
// origin: a different issuer or host is never trusted with a code or a bearer.
export function readMetadata(
  body: unknown,
  target: StdioTarget,
  form: AddressForm = target.forms[0] ?? { issuer: target.issuer, metadataUrl: target.metadataUrl },
): AuthorizationServer {
  const document = record(body);
  if (document.issuer !== form.issuer) {
    return refuse('names an issuer other than this tenant address at this base URL');
  }
  const methods = document.code_challenge_methods_supported;
  if (!Array.isArray(methods) || !methods.includes('S256')) {
    return refuse('does not offer PKCE with S256');
  }
  return {
    issuer: form.issuer,
    authorizationEndpoint: endpointOf(
      document,
      'authorization_endpoint',
      new URL(form.issuer).origin,
    ),
    tokenEndpoint: endpointOf(document, 'token_endpoint', new URL(form.issuer).origin),
    issuerAdvertised: document.authorization_response_iss_parameter_supported === true,
  };
}
