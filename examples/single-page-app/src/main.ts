// A single-page app: it signs a person in with the authorization code grant
// and PKCE, as a public client with no secret. The tokens live in a variable,
// so a reload signs the person out of the app. The client is registered
// without the refresh_token grant, so there is no refresh token to steal.
// Only the short-lived record the redirect needs, which holds the PKCE
// verifier, the state and the nonce, waits in sessionStorage while the person
// is on Odudu's page. `allowInsecureRequests` lets the SDK talk to an http
// issuer; a real app serves everything over HTTPS and never sets it.
import {
  beginSignIn,
  completeSignIn,
  OduduError,
  signOutUrl,
  type Pending,
  type TokenSet,
} from '@odudu-io/oidc';

const BASE = import.meta.env.VITE_ODUDU_BASE ?? 'http://localhost:3000';
const ISSUER = `${BASE}/tenants/${import.meta.env.VITE_TENANT ?? 'demo'}`;
const CLIENT_ID = import.meta.env.VITE_CLIENT_ID ?? 'example-spa';
const REDIRECT_URI = `${location.origin}/callback`;
const PENDING = 'odudu.pending';
const deps = { allowInsecureRequests: true };

let tokens: TokenSet | undefined;

const root = document.querySelector('#app');

function show(text: string, action?: { label: string; run: () => void }): void {
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  const children: HTMLElement[] = [paragraph];
  if (action !== undefined) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    children.push(button);
  }
  root?.replaceChildren(...children);
}

async function signIn(): Promise<void> {
  const { url, pending } = await beginSignIn(
    { issuer: ISSUER, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scope: 'openid profile' },
    deps,
  );
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  location.assign(url);
}

async function finishSignIn(): Promise<TokenSet> {
  const stored = sessionStorage.getItem(PENDING);
  // A callback can be used once: the record it needs is gone after the first.
  sessionStorage.removeItem(PENDING);
  if (stored === null) throw new Error('No sign-in is under way');
  // Checks the state and the issuer, exchanges the code and validates the ID token.
  return completeSignIn(location.href, JSON.parse(stored) as Pending, deps);
}

async function signOut(): Promise<void> {
  const idToken = tokens?.idToken ?? '';
  tokens = undefined;
  location.assign(
    await signOutUrl(
      { issuer: ISSUER, idToken, postLogoutRedirectUri: `${location.origin}/` },
      deps,
    ),
  );
}

// The page keeps saying "signed in" after the access token lapses, because the
// app calls no API. An app that does reads `expiresAt` and signs the person in
// again once it has passed.
function render(): void {
  if (tokens === undefined) {
    show('You are signed out.', { label: 'Sign in', run: () => attempt(signIn()) });
    return;
  }
  const { claims } = tokens;
  const expiresAt = new Date(tokens.byAudience[ISSUER]?.expiresAt ?? Number.NaN);
  const expiry = Number.isNaN(expiresAt.getTime())
    ? 'at a time this app cannot read'
    : expiresAt.toISOString();
  show(
    `Signed in as ${String(claims.preferred_username ?? claims.sub)} (${claims.sub}). ` +
      `Access token expires ${expiry}`,
    { label: 'Sign out', run: () => attempt(signOut()) },
  );
}

// The SDK's code and wording for what failed, never the values it compared.
function why(error: unknown): string {
  return error instanceof OduduError ? `${error.code}: ${error.message}` : String(error);
}

// Something that failed before the person reached Odudu's page, such as an
// unreachable server, is shown rather than dropped.
function attempt(task: Promise<void>): void {
  task.catch((error: unknown) => {
    console.error(`failed: ${why(error)}`);
    show('Something went wrong.');
  });
}

if (location.pathname === '/callback') {
  finishSignIn().then(
    (signedIn) => {
      tokens = signedIn;
      history.replaceState(null, '', '/');
      render();
    },
    (error: unknown) => {
      console.error(`sign-in refused: ${why(error)}`);
      history.replaceState(null, '', '/');
      show('Sign-in was refused.', { label: 'Try again', run: () => attempt(signIn()) });
    },
  );
} else {
  render();
}
