import { expect, it } from 'vitest';
import { hostProblem, trimmedHost } from '#/pages/domains/services/register';

it('asks for a host when none was typed', () => {
  expect(hostProblem('')).toBe(
    'Enter the host the tenant will sign in at, such as login.acme.com.',
  );
  expect(hostProblem('   ')).not.toBeNull();
});

it('leaves every other judgement of the host to the server', () => {
  expect(hostProblem('Login.ACME.com')).toBeNull();
  expect(hostProblem('login.acme.com')).toBeNull();
});

it('sends the host without the spaces around it', () => {
  expect(trimmedHost('  login.acme.com ')).toBe('login.acme.com');
});
