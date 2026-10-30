import { createHash } from 'node:crypto';

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const CLIENT_ROW = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const FILE = /^([0-9a-f]{64})\.(png|jpg|webp|css)$/u;

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

// The type an upload of this mime is served under; null for one no upload
// produces.
export function assetExtension(mime: string): string | null {
  return EXTENSION[mime] ?? null;
}

// Where a tenant's image is served: its content hash, so the URL changes
// when the bytes do. Null for a type no upload produces.
export function assetPath(tenantName: string, sha256: string, mime: string): string | null {
  const extension = assetExtension(mime);
  return extension === null
    ? null
    : `/tenants/${encodeURIComponent(tenantName)}/brand/${sha256}.${extension}`;
}

// The hashed stylesheet of a resolved theme. A route receives only the URL,
// so the pieces its hash was made from must be derivable from it: the tenant
// is in the path and, when a client's theme is one of the layers, so is the
// client's row id (a uuid, safe in a CSP path), from which the route
// resolves the same layers again.
export function stylesheetPath(
  tenantName: string,
  css: string,
  clientRowId: string | null = null,
): string {
  const scope = clientRowId === null ? '' : `c/${clientRowId}/`;
  return `/tenants/${encodeURIComponent(tenantName)}/brand/${scope}${sha256Hex(css)}.css`;
}

export type BrandFile =
  { kind: 'image'; sha256: string; extension: string } | { kind: 'css'; sha256: string };

// The last path segment of a brand URL, or null for anything but a hash and
// one of the four extensions the URLs above produce.
export function parseBrandFile(file: string): BrandFile | null {
  const match = FILE.exec(file);
  const sha256 = match?.[1];
  const extension = match?.[2];
  if (sha256 === undefined || extension === undefined) return null;
  return extension === 'css' ? { kind: 'css', sha256 } : { kind: 'image', sha256, extension };
}

export function isClientRowId(value: string): boolean {
  return CLIENT_ROW.test(value);
}
