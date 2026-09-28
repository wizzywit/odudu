import { isUuid } from '@odudu/kernel';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SEPARATOR = '.';
const BASE64URL = /^[A-Za-z0-9_-]+$/u;

export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

// Compared as digests, so neither the content nor the length of the
// expected value shows in the time a mismatch takes.
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

// The OAuth state and the session cookie both carry their tenant in the
// clear, so the row behind either is read under that tenant's context.
export function bindToTenant(tenantId: string, secret: string): string {
  return `${tenantId}${SEPARATOR}${secret}`;
}

export function splitTenantBound(value: string): { tenantId: string; secret: string } | null {
  const parts = value.split(SEPARATOR);
  if (parts.length !== 2) return null;
  const [tenantId = '', secret = ''] = parts;
  if (!isUuid(tenantId) || !BASE64URL.test(secret)) return null;
  return { tenantId, secret };
}
