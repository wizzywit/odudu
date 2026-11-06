import { type TenantAddress } from '@odudu/kernel';
import { resourceMetadataUrl } from '#/service/resource';

// The challenge of a request with no usable token. `resource_metadata` is what
// starts a client's sign-in (RFC 9728 §5.1); `scope` names what the first
// request needs.
export function challengeFor(address: TenantAddress, scope: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl(address)}", scope="${scope}"`;
}

// The challenge of a valid token that lacks a scope (RFC 6750 §3.1), naming
// every scope the call needs so a client can ask for them in one step-up.
export function insufficientScope(address: TenantAddress, scopes: readonly string[]): string {
  return `Bearer error="insufficient_scope", scope="${scopes.join(' ')}", resource_metadata="${resourceMetadataUrl(address)}"`;
}

// The challenge of a token that did not verify or no longer stands (RFC 6750
// §3.1). It names no reason beyond `invalid_token`, so a caller learns nothing
// about which check refused it, and it still points at the metadata so a
// client can start its sign-in again.
export function invalidToken(address: TenantAddress, scope: string): string {
  return `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl(address)}", scope="${scope}"`;
}
