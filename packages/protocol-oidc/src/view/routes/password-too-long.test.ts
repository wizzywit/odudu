import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import { MAX_PASSWORD_LENGTH } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { registerLoginRoute, type LoginRouteDeps } from '#/view/routes/login';
import {
  registerRequiredActionRoute,
  type RequiredActionRouteDeps,
} from '#/view/routes/required-action';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'error.passwordTooLong': 'Le mot de passe ne doit pas dépasser {max} caractères.',
  });
});

vi.mock('../../../../authn-flows/src/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'updatePassword.rule.maxLength':
      'Le mot de passe ne doit pas dépasser {max, number, ::group-off} caractères.',
  });
});

const TOO_LONG = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
const SESSION = '01a0a998-8326-7900-8fa6-dd06b842b269';
const tenant = {
  id: 't1',
  supportedLocales: ['en', 'fr'],
  defaultLocale: null,
  passwordRules: {
    minLength: 15,
    requireDigit: false,
    requireUppercase: false,
    requireLowercase: false,
    requireSpecial: false,
  },
};

const continuationDeps = {
  findTenant: vi.fn().mockResolvedValue(tenant),
  loadPendingRequest: vi.fn().mockResolvedValue(null),
  recoverPendingRequest: vi.fn().mockResolvedValue(null),
  redirectStillRegistered: vi.fn().mockResolvedValue(true),
};

async function post(
  register: (app: FastifyInstance) => void,
  url: string,
  acceptLanguage?: string,
) {
  const app = Fastify();
  await app.register(formbody);
  register(app);
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams({
      auth_session_id: SESSION,
      username: 'ada',
      password: TOO_LONG,
    }).toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage }),
    },
  });
  await app.close();
  return res;
}

const login = (app: FastifyInstance): void => {
  registerLoginRoute(app, { tls: false, ...continuationDeps } as unknown as LoginRouteDeps);
};
const requiredAction = (app: FastifyInstance): void => {
  registerRequiredActionRoute(app, {
    ...continuationDeps,
    authenticatedSubject: vi.fn().mockResolvedValue('s1'),
  } as unknown as RequiredActionRouteDeps);
};

describe('a password past the length bound', () => {
  it('is refused on the login form with the catalogue sentence, in the page language', async () => {
    const url = '/tenants/acme/login-actions/authenticate';
    const en = await post(login, url);
    expect(en.statusCode).toBe(400);
    expect(en.body).toContain('<bdi>Password must be at most 256 characters long.</bdi>');
    const fr = await post(login, url, 'fr');
    expect(fr.body).toContain('<bdi>Le mot de passe ne doit pas dépasser 256 caractères.</bdi>');
  });

  it('is refused on the update-password page by rule code, which that page words', async () => {
    const url = '/tenants/acme/login-actions/required-action?action=update-password';
    const en = await post(requiredAction, url);
    expect(en.statusCode).toBe(400);
    expect(en.body).toContain('>Password must be at most 256 characters long.</li>');
    const fr = await post(requiredAction, url, 'fr');
    expect(fr.statusCode).toBe(400);
    expect(fr.headers['content-language']).toBe('fr');
    expect(fr.body).toContain('>Le mot de passe ne doit pas dépasser 256 caractères.</li>');
  });
});
