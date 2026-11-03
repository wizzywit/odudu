import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@site/src/features/landing/services/installCommands';
import { RELEASE_URL } from '@site/src/features/landing/services/release';

describe('the install commands', () => {
  it('gives each shell its own command, both from the release address', () => {
    expect(RELEASE_URL).toMatch(
      /^https:\/\/github\.com\/.+\/releases\/download\/v[^/]+\/compose\.yaml$/,
    );
    expect(COMMANDS.map((entry) => [entry.shell, entry.label])).toEqual([
      ['unix', 'bash or zsh'],
      ['windows', 'PowerShell'],
    ]);
    expect(COMMANDS[0]?.command).toBe(`curl -fsSLO ${RELEASE_URL} && docker compose up -d`);
    expect(COMMANDS[1]?.command).toBe(
      `curl.exe -fsSLO ${RELEASE_URL}; if ($?) { docker compose up -d }`,
    );
  });
});
