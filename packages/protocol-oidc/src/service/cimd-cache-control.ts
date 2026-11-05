export const CIMD_CACHE_MIN_SECONDS = 60;
export const CIMD_CACHE_MAX_SECONDS = 86_400;

// How long a fetched document may be reused, or null when it may not be kept
// at all. `no-cache` is refused as well as `no-store`: it asks for
// revalidation, and nothing here holds the validators to do it. A response
// that states no freshness is kept for the shortest time rather than the
// longest, so an owner who changes a document waits at most a minute.
export function cimdCacheSeconds(header: string | null): number | null {
  if (header === null) return CIMD_CACHE_MIN_SECONDS;
  let maxAge: number | null = null;
  for (const part of header.split(',')) {
    const [rawName = '', ...rest] = part.split('=');
    const name = rawName.trim().toLowerCase();
    if (name === 'no-store' || name === 'no-cache') return null;
    if (name === 'max-age') {
      const value = rest
        .join('=')
        .trim()
        .replace(/^"(.*)"$/u, '$1');
      if (/^\d{1,10}$/u.test(value)) maxAge = Number(value);
    }
  }
  const seconds = maxAge ?? CIMD_CACHE_MIN_SECONDS;
  return Math.min(CIMD_CACHE_MAX_SECONDS, Math.max(CIMD_CACHE_MIN_SECONDS, seconds));
}
