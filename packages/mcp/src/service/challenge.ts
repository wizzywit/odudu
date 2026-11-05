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
