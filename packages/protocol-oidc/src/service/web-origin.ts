// A bare origin: scheme, host, optional port. No path, no query, no
// fragment, no wildcard. `+` is the one non-origin value permitted, and
// means "derive from this client's registered redirect URIs".
const ORIGIN_PATTERN = /^https?:\/\/[^/?#\s*]+$/;

export function isWellFormedWebOrigin(value: string): boolean {
  if (value === '+') return true;
  if (!ORIGIN_PATTERN.test(value)) return false;
  return normalizeOrigin(value) !== null;
}

export function normalizeOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

export function expandWebOrigins(
  configured: readonly string[],
  redirectUris: readonly string[],
): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const entry of configured) {
    if (entry === '+') {
      for (const uri of redirectUris) {
        const origin = normalizeOrigin(uri);
        if (origin !== null) origins.add(origin);
      }
      continue;
    }
    const origin = normalizeOrigin(entry);
    if (origin !== null) origins.add(origin);
  }
  return origins;
}
