import { ME_READ_SCOPE } from '@odudu/domain-tenant';

// The scope a read needs. An agent-marked token (`act`) is held to the same:
// the bar on an agent is on writes alone.
export function mayRead(scopes: readonly string[]): boolean {
  return scopes.includes(ME_READ_SCOPE);
}
