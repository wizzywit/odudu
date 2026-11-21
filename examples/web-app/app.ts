// A web app with a server: it signs a person in with the authorization code
// grant and PKCE, keeps who they are in a server-side session, and signs them
// out of Odudu too. For the example, sessions live in memory, never expire and
// travel over plain http, and `allowInsecureRequests` lets the SDK talk to an
// http issuer; a production app needs HTTPS, `Secure` cookies and a real
// session store, and never allows insecure requests.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { beginSignIn, completeSignIn, OduduError, signOutUrl, type Pending } from '@odudu-io/oidc';

const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const ISSUER = `${BASE}/tenants/${process.env.TENANT ?? 'demo'}`;
const PORT = Number(process.env.PORT ?? 8081);
const ORIGIN = `http://localhost:${PORT}`;
const CLIENT_ID = process.env.CLIENT_ID ?? 'example-web';
// A published value for the local example stack; never reuse it anywhere real.
const SECRET = process.env.CLIENT_SECRET ?? 'example-web-secret';
const deps = { allowInsecureRequests: true };

interface Session {
  pending?: Pending;
  person?: { sub: string; name: string; idToken: string };
}
const sessions = new Map<string, Session>();
const cookieFor = (id: string, maxAge = '') => `sid=${id}; HttpOnly; SameSite=Lax; Path=/${maxAge}`;

createServer((request, response) => {
  const cookie = /(?:^|; )sid=([^;]+)/u.exec(request.headers.cookie ?? '')?.[1] ?? '';
  const session = sessions.get(cookie) ?? {};
  const url = new URL(request.url ?? '/', ORIGIN);
  const send = (status: number, body: string) => {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  };
  const redirect = (to: string, setCookie: string) => {
    response.writeHead(302, { location: to, 'set-cookie': setCookie });
    response.end();
  };
  // A new session id at each step, so a stale one cannot be fixed on a person.
  const begin = (value: Session) => {
    const id = randomBytes(24).toString('base64url');
    sessions.set(id, value);
    return id;
  };

  if (url.pathname === '/login') {
    // `pending` holds the PKCE verifier, the state and the nonce for the round trip.
    beginSignIn(
      {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: `${ORIGIN}/callback`,
        scope: 'openid profile',
      },
      deps,
    ).then(
      ({ url: target, pending }) => redirect(target, cookieFor(begin({ pending }))),
      () => send(500, '<p>Could not start sign-in.</p>'),
    );
  } else if (url.pathname === '/callback') {
    const { pending } = session;
    if (pending === undefined) return send(400, '<p>No sign-in is under way.</p>');
    sessions.delete(cookie);
    // Checks state, the issuer, the code's PKCE proof and the ID token's issuer, audience,
    // expiry and nonce. The signature is not checked.
    completeSignIn(url.href, pending, deps, { auth: { secret: SECRET } }).then(
      (tokens) => {
        const sub = tokens.claims.sub;
        const name = String(tokens.claims.preferred_username ?? sub);
        redirect('/', cookieFor(begin({ person: { sub, name, idToken: tokens.idToken } })));
      },
      (error: unknown) => {
        console.error(`sign-in refused: ${why(error)}`);
        send(400, '<p>Sign-in was refused.</p>');
      },
    );
  } else if (url.pathname === '/logout' && request.method === 'POST') {
    sessions.delete(cookie);
    // Ends the person's session at Odudu too, which the id_token_hint names.
    const clear = cookieFor('', '; Max-Age=0');
    if (session.person === undefined) return redirect('/', clear);
    signOutUrl(
      { issuer: ISSUER, idToken: session.person.idToken, postLogoutRedirectUri: `${ORIGIN}/` },
      deps,
    ).then(
      (target) => redirect(target, clear),
      () => redirect('/', clear),
    );
  } else {
    const { person } = session;
    send(
      200,
      person
        ? `<p>Signed in as ${esc(person.name)} (${esc(person.sub)})</p>` +
            '<form method="post" action="/logout"><button>Sign out</button></form>'
        : '<p>You are signed out. <a href="/login">Sign in</a></p>',
    );
  }
}).listen(PORT, () => {
  console.log(`web app on ${ORIGIN}, trusting ${ISSUER}`);
});

// The SDK's code and wording for what failed, never the values it compared:
// those hold the code and the state.
function why(error: unknown): string {
  if (!(error instanceof OduduError)) return String(error);
  return `${error.code}: ${error.message}`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/gu, (c) => `&#${String(c.charCodeAt(0))};`);
}
