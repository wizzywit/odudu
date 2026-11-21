// A page that asks the server who is signed in. The tokens stay on the server:
// the page holds nothing, and the browser holds an HttpOnly cookie it cannot read.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OduduProvider, SignedIn, SignedOut, useAuth, useBffFetch, useUser } from '@odudu-io/react';

// The server adds the access token to this call; the page never sees it.
function Api() {
  const call = useBffFetch();
  const [answer, setAnswer] = useState('');
  const ask = async () => setAnswer(await (await call('api/hello')).text());
  return (
    <>
      <button onClick={ask}>Call the API</button>
      <p>API says: {answer}</p>
    </>
  );
}

function Account() {
  const { signOut } = useAuth();
  const claims = useUser();
  const name = String(claims?.preferred_username ?? claims?.sub);
  return (
    <>
      <p>Signed in as {name}</p>
      <pre>{JSON.stringify(claims, null, 2)}</pre>
      <Api />
      <button onClick={signOut}>Sign out</button>
    </>
  );
}

function Welcome() {
  const { signIn } = useAuth();
  return (
    <>
      <p>You are signed out.</p>
      <button onClick={() => signIn()}>Sign in</button>
    </>
  );
}

// A failed check is shown as such, never as a signed-out person.
function Failure() {
  const { error } = useAuth();
  return error === undefined ? null : <p>Could not check the session: {error.code}</p>;
}

createRoot(document.getElementById('root') ?? document.body).render(
  // `baseUrl` is where the server mounts the BFF routes.
  <OduduProvider mode={{ kind: 'bff', baseUrl: '/bff' }}>
    <SignedOut>
      <Welcome />
    </SignedOut>
    <SignedIn>
      <Account />
    </SignedIn>
    <Failure />
  </OduduProvider>,
);
