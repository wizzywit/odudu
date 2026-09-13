import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 declares Algorithm as an ambient const enum, which
// verbatimModuleSyntax forbids importing as a value — 2 is Argon2.Algorithm.Argon2id
// (see index.d.ts in the package).
const ARGON2ID = 2;

// OWASP Password Storage Cheat Sheet, Argon2id section: minimum recommended
// baseline is 19 MiB memory, 2 iterations, 1 degree of parallelism.
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain, OPTIONS);
  } catch {
    // A hash corrupted by a bad migration must fail the login, not the request.
    return false;
  }
}
