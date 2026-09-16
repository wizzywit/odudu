import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

const HMAC_ALGORITHM: Record<TotpAlgorithm, string> = {
  'SHA-1': 'sha1',
  'SHA-256': 'sha256',
  'SHA-512': 'sha512',
};

const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
const DEFAULT_ALGORITHM: TotpAlgorithm = 'SHA-1';
const SECRET_BYTES = 20; // RFC 6238 §5.1: a key SHOULD match the HMAC output it is used with.
const VERIFY_WINDOW_STEPS = 1; // RFC 6238 §5.2/§6: one time step of network delay/clock drift either side.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const VERIFY_CODE_SHAPE = /^\d{6}$/u;

function alphabetChar(index: number): string {
  const char = BASE32_ALPHABET[index];
  if (char === undefined) {
    throw new RangeError(`base32 alphabet index out of range: ${String(index)}`);
  }
  return char;
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabetChar((value >>> (bits - 5)) & 0x1f);
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabetChar((value << (5 - bits)) & 0x1f);
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new RangeError(`not a base32 character: ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function byteAt(buf: Uint8Array, index: number): number {
  const value = buf[index];
  if (value === undefined) {
    throw new RangeError(`byte index out of range: ${String(index)}`);
  }
  return value;
}

/** RFC 4226 §5.3 dynamic truncation, applied to an HMAC digest computed over a big-endian counter. */
function hotp(key: Buffer, counter: number, digits: number, algorithm: TotpAlgorithm): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt.asUintN(64, BigInt(counter)));

  const hmac = createHmac(HMAC_ALGORITHM[algorithm], key).update(counterBuffer).digest();
  const offset = byteAt(hmac, hmac.length - 1) & 0x0f;
  const truncated =
    ((byteAt(hmac, offset) & 0x7f) << 24) |
    ((byteAt(hmac, offset + 1) & 0xff) << 16) |
    ((byteAt(hmac, offset + 2) & 0xff) << 8) |
    (byteAt(hmac, offset + 3) & 0xff);

  return String(truncated % 10 ** digits).padStart(digits, '0');
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function totpCounter(now: Date, stepSeconds: number = DEFAULT_STEP_SECONDS): number {
  return Math.floor(now.getTime() / 1000 / stepSeconds);
}

export function totpCode(
  secret: string,
  counter: number,
  digits: number = DEFAULT_DIGITS,
  algorithm: TotpAlgorithm = DEFAULT_ALGORITHM,
): string {
  return hotp(base32Decode(secret), counter, digits, algorithm);
}

export function verifyTotp(input: {
  secret: string;
  code: string;
  now: Date;
  lastStep: number | null;
}): { ok: false } | { ok: true; step: number } {
  const { secret, code, now, lastStep } = input;
  if (!VERIFY_CODE_SHAPE.test(code)) return { ok: false };

  const codeBuffer = Buffer.from(code, 'utf8');
  const currentStep = totpCounter(now);

  for (let offset = -VERIFY_WINDOW_STEPS; offset <= VERIFY_WINDOW_STEPS; offset++) {
    const step = currentStep + offset;
    if (lastStep !== null && step <= lastStep) continue;

    const candidate = totpCode(secret, step, DEFAULT_DIGITS, DEFAULT_ALGORITHM);
    if (timingSafeEqual(codeBuffer, Buffer.from(candidate, 'utf8'))) {
      return { ok: true, step };
    }
  }

  return { ok: false };
}
