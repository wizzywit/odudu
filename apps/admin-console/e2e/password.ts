import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every username the setup and the specs seed, read from their source: the
// password policy refuses a password that contains the username, and a name of
// three or more letters can turn up in random base64 by chance.
function seededUsernames(): readonly string[] {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    if (file !== 'global-setup.ts' && !file.endsWith('.spec.ts')) continue;
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const match of text.matchAll(/username: '([a-z]{3,})'/gu)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
    for (const match of text.matchAll(/'--username',\s*'([a-z]{3,})'/gu)) {
      if (match[1] !== undefined) names.add(match[1]);
    }
  }
  return [...names].sort();
}

export const SEEDED_USERNAMES = seededUsernames();

const MAX_ATTEMPTS = 100;

export function randomPassword(
  prefix = '',
  avoid: readonly string[] = SEEDED_USERNAMES,
  bytes = 18,
): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidate = `${prefix}${randomBytes(bytes).toString('base64url')}`;
    const lower = candidate.toLowerCase();
    if (!avoid.some((name) => lower.includes(name.toLowerCase()))) return candidate;
  }
  throw new Error(
    `randomPassword: no password with prefix "${prefix}" avoided every name in ${String(MAX_ATTEMPTS)} draws; the prefix or the avoid list contains an avoided name`,
  );
}
