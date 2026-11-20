export interface FakeBffCall {
  method: string;
  url: string;
  header: string | null;
  credentials: RequestCredentials | undefined;
}

export interface FakeBff {
  // What `/session` answers: signed in as this subject, or 401.
  authenticated: boolean;
  // Answers `/session` with this status instead of the usual one.
  sessionStatus: number | undefined;
  logoutRedirect: string | undefined;
  calls: FakeBffCall[];
  fetch: typeof fetch;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Stands in for @odudu-io/bff's routes. Like the real ones, every route but
// the login navigation refuses a request without the X-Odudu-BFF header.
export function fakeBff(baseUrl: string): FakeBff {
  const fake: FakeBff = {
    authenticated: true,
    sessionStatus: undefined,
    logoutRedirect: 'https://issuer.example/logout?client_id=app',
    calls: [],
    fetch: (input, init) => {
      const request = new Request(
        new URL(input instanceof Request ? input.url : String(input), location.origin),
        init,
      );
      const header = request.headers.get('x-odudu-bff');
      fake.calls.push({
        method: request.method,
        url: request.url,
        header,
        credentials: init?.credentials,
      });
      const path = new URL(request.url).pathname;
      const base = new URL(baseUrl, 'http://app.test').pathname;
      if (header === null || header === '')
        return Promise.resolve(new Response(null, { status: 403 }));
      if (path === `${base}/session` && fake.sessionStatus !== undefined) {
        return Promise.resolve(new Response('upstream detail', { status: fake.sessionStatus }));
      }
      if (!fake.authenticated && path !== `${base}/logout`) {
        return Promise.resolve(json(401, { authenticated: false }));
      }
      if (path === `${base}/session`) {
        return Promise.resolve(
          json(200, { authenticated: true, claims: { sub: 'subject-1', name: 'Ada' } }),
        );
      }
      if (path === `${base}/logout`) {
        fake.authenticated = false;
        return Promise.resolve(
          fake.logoutRedirect === undefined
            ? new Response(null, { status: 204 })
            : json(200, { redirectTo: fake.logoutRedirect }),
        );
      }
      if (path.startsWith(`${base}/proxy/`)) return Promise.resolve(json(200, { ok: true }));
      return Promise.resolve(new Response(null, { status: 404 }));
    },
  };
  return fake;
}
