import path from 'node:path';

const PREFIX = '/console/';

function decodeOnce(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * Confines a caller-supplied redirect target to the console's own tree.
 * Decodes once, normalises with `path.posix`, and refuses anything that
 * would leave `/console/` or carry a backslash a browser could read as a
 * host separator.
 */
export function safeReturnTo(value: string | undefined): string {
  if (value === undefined || value === '') return PREFIX;

  const decoded = decodeOnce(value);
  if (decoded === undefined || decoded.includes('\\')) return PREFIX;

  const normalised = path.posix.normalize(decoded);
  if (!normalised.startsWith(PREFIX)) return PREFIX;

  return decoded;
}
