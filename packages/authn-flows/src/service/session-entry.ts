import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isUuid } from '@odudu/kernel';

const PAIR = ':';
const SECRET = /^[A-Za-z0-9_-]{43}$/;

function sha256(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

// One session as a browser's cookie carries it: the row's id, which is also
// the public `sid` claim, and the secret that alone proves possession. The
// secret is a private field, so logging or serialising an entry shows only
// its id.
export class SessionEntry {
  readonly #secret: string;

  private constructor(
    readonly id: string,
    secret: string,
  ) {
    this.#secret = secret;
  }

  static issue(id: string): SessionEntry {
    return new SessionEntry(id, randomBytes(32).toString('base64url'));
  }

  static parse(value: string): SessionEntry | null {
    const index = value.indexOf(PAIR);
    if (index === -1) return null;
    const id = value.slice(0, index);
    const secret = value.slice(index + 1);
    if (!isUuid(id) || !SECRET.test(secret)) return null;
    return new SessionEntry(id, secret);
  }

  secretHash(): string {
    return sha256(this.#secret).toString('hex');
  }

  matches(storedHash: string | null): boolean {
    if (storedHash === null) return false;
    const stored = Buffer.from(storedHash, 'hex');
    const presented = sha256(this.#secret);
    return stored.length === presented.length && timingSafeEqual(stored, presented);
  }

  // A value bound to this session and to `purpose`, keyed by the secret:
  // whoever holds only the public id cannot compute it, and the secret
  // never leaves the cookie to produce it.
  proof(purpose: string): string {
    return createHmac('sha256', this.#secret).update(`${purpose}:${this.id}`).digest('base64url');
  }

  proves(purpose: string, presented: string): boolean {
    const expected = Buffer.from(this.proof(purpose));
    const received = Buffer.from(presented);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  cookieValue(): string {
    return `${this.id}${PAIR}${this.#secret}`;
  }
}
