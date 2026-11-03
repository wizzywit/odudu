import { describe, expect, it } from 'vitest';
import {
  AGENT_ITEMS,
  CAPABILITIES,
  COMMANDS,
  PAGE_SHOTS,
  RELEASE_URL,
  STEPS,
  claimText,
} from '@site/src/features/landing/services/content';
import manifest from '@site/static/server-pages/manifest.json';

describe('what the landing page says', () => {
  it('words each claim the scene names, and leaves an unknown one as it is', () => {
    expect(claimText('passwords')).toBe('Passwords');
    expect(claimText('passkeys')).toBe('Passkeys');
    expect(claimText('authenticator-codes')).toBe('Authenticator codes');
    expect(claimText('single-sign-on')).toBe('Single sign-on across one tenant');
    expect(claimText('back-channel-logout')).toBe('Back-channel logout');
    expect(claimText('something-else')).toBe('something-else');
  });

  it('shows the three steps of the start, in order', () => {
    expect(STEPS.map((step) => step.title)).toEqual([
      'Start it',
      'Sign in to the console',
      'Sign a person in to an app',
    ]);
  });

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

  it('lists the capabilities and the planned agent items by name', () => {
    expect(CAPABILITIES.map((card) => card.title)).toEqual([
      'Standard sign-in',
      'Many tenants',
      'Passwords and second factors',
      'Sessions that end properly',
      'Services and delegation',
      'An admin API and console',
      'An audit trail',
      'One container and Postgres',
    ]);
    expect(AGENT_ITEMS.map((item) => item.id)).toEqual(['mcp-server', 'agent-identity']);
  });

  it('shows only server pages the capture has written', () => {
    expect(PAGE_SHOTS).toHaveLength(4);
    for (const shot of PAGE_SHOTS) expect(Object.keys(manifest)).toContain(shot.name);
  });
});
