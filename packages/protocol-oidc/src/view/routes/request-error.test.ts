import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { en } from '#/view/messages';
import { sendSignInExpired } from '#/view/routes/expired-sign-in';
import { sendRequestError } from '#/view/routes/request-error';

vi.mock('#/view/messages', async (importOriginal) => {
  const { withFrench } = await import('@odudu/testkit/i18n');
  return withFrench(await importOriginal(), {
    'error.unknownTenant': 'Locataire inconnu.',
    'error.signInExpired': 'Cette tentative de connexion n’est plus valide.',
  });
});

async function answer(acceptLanguage?: string) {
  const app = Fastify();
  const deps = {
    findTenant: () =>
      Promise.resolve({ id: 't1', supportedLocales: ['en', 'fr'], defaultLocale: null }),
  };
  app.get('/p', (_request, reply) =>
    sendRequestError(reply, deps, 'acme', 400, 'error.unknownTenant'),
  );
  app.get('/e', (_request, reply) =>
    sendSignInExpired(
      reply,
      {
        loadPendingRequest: () => Promise.resolve(null),
        recoverPendingRequest: () => Promise.resolve(null),
        redirectStillRegistered: () => Promise.resolve(true),
        ...deps,
      },
      'acme',
      undefined,
    ),
  );
  const headers = acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage };
  const [request, expired] = await Promise.all([
    app.inject({ url: '/p', headers }),
    app.inject({ url: '/e', headers }),
  ]);
  await app.close();
  return { request, expired };
}

describe('the error pages of a request with no parked sign-in', () => {
  it('say the catalogue sentence in English by default', async () => {
    const { request, expired } = await answer();
    expect(request.statusCode).toBe(400);
    expect(request.headers['content-language']).toBe('en');
    expect(request.body).toContain(`<p><bdi>${en['error.unknownTenant']}</bdi></p>`);
    expect(expired.body).toContain(`<bdi>${en['error.signInExpired']}</bdi>`);
  });

  it('say it in the language Accept-Language asks for', async () => {
    const { request, expired } = await answer('fr');
    expect(request.headers['content-language']).toBe('fr');
    expect(request.body).toContain('<html lang="fr" dir="ltr">');
    expect(request.body).toContain('<p><bdi>Locataire inconnu.</bdi></p>');
    expect(expired.body).toContain('<bdi>Cette tentative de connexion n’est plus valide.</bdi>');
  });
});
