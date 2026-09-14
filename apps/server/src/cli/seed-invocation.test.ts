import { describe, expect, it } from 'vitest';
import { resolveSeedInvocation } from '#/cli/seed-invocation';

// main.ts runs its own boot sequence at module scope the moment it is
// imported, so the routing decision it makes for `seed ...` argv is tested
// here instead, against the pure function main.ts calls rather than
// against main.ts itself.
describe('resolveSeedInvocation', () => {
  it('routes a subcommand name to the identity-model command form', () => {
    const invocation = resolveSeedInvocation(['role', '--realm', 'demo', '--name', 'admin']);

    expect(invocation).toEqual({
      kind: 'command',
      argv: ['role', '--realm', 'demo', '--name', 'admin'],
    });
  });

  it('routes every produced subcommand name, not just one', () => {
    for (const command of [
      'realm',
      'client',
      'user',
      'role',
      'group',
      'scope',
      'assign-scope',
      'map-role',
      'grant-role',
      'join-group',
      'profile',
    ]) {
      expect(resolveSeedInvocation([command])).toMatchObject({ kind: 'command' });
    }
  });

  it('routes the older --realm/--client form to the bootstrap form', () => {
    const invocation = resolveSeedInvocation([
      '--realm',
      'demo',
      '--client',
      'demo-spa',
      '--redirect-uri',
      'https://app.example/cb',
    ]);

    expect(invocation).toEqual({
      kind: 'bootstrap',
      options: {
        realm: 'demo',
        clientId: 'demo-spa',
        redirectUris: ['https://app.example/cb'],
      },
    });
  });

  it('routes empty argv to the bootstrap form, which then refuses it', () => {
    expect(() => resolveSeedInvocation([])).toThrow(/requires --realm and --client/);
  });
});
