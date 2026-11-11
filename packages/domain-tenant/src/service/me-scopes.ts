export const ME_READ_SCOPE = 'me:read';
export const ME_WRITE_SCOPE = 'me:write';

export const ME_SCOPES: readonly string[] = [ME_READ_SCOPE, ME_WRITE_SCOPE];

export function isMeScope(scope: string): boolean {
  return ME_SCOPES.includes(scope);
}

export function holdsMeScope(scopes: readonly string[]): boolean {
  return scopes.some(isMeScope);
}

export const ME_WRITE_NEEDS_READ_MESSAGE = 'the scope me:write is held only together with me:read';

export function meWriteNeedsRead(scopes: readonly string[]): boolean {
  return !scopes.includes(ME_WRITE_SCOPE) || scopes.includes(ME_READ_SCOPE);
}
