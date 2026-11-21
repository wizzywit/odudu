# @odudu-io/react

This package puts a signed-in person into a React tree. It runs in one of two modes: `bff`, where a server you run keeps the tokens and the page holds only a cookie, or `browser`, where the page runs the sign-in itself and keeps the tokens in memory.

## Install

```text
npm install @odudu-io/react
```

It needs React 19 (`react` and `react-dom` are peer dependencies), and its `engines` field names Node 24 or later. It depends on [`@odudu-io/oidc`](https://wizzywit.github.io/odudu/docs/sdks/oidc/), which installs with it. For `bff` mode you also run [`@odudu-io/bff`](https://wizzywit.github.io/odudu/docs/sdks/bff/) or [`@odudu-io/next`](https://wizzywit.github.io/odudu/docs/sdks/next/) on a server.

## The shortest use

This is the page of [the React and BFF example](https://github.com/wizzywit/odudu/tree/main/examples/react-bff). The server mounts the BFF's routes under `/bff`.

```tsx
import { createRoot } from 'react-dom/client';
import { OduduProvider, SignedIn, SignedOut, useAuth, useUser } from '@odudu-io/react';

function Account() {
  const { signOut } = useAuth();
  const claims = useUser();
  return (
    <>
      <p>Signed in as {String(claims?.preferred_username ?? claims?.sub)}</p>
      <button onClick={signOut}>Sign out</button>
    </>
  );
}

function Welcome() {
  const { signIn } = useAuth();
  return <button onClick={() => signIn()}>Sign in</button>;
}

createRoot(document.getElementById('root') ?? document.body).render(
  <OduduProvider mode={{ kind: 'bff', baseUrl: '/bff' }}>
    <SignedOut>
      <Welcome />
    </SignedOut>
    <SignedIn>
      <Account />
    </SignedIn>
  </OduduProvider>,
);
```

## More

The full reference is on the [documentation site](https://wizzywit.github.io/odudu/docs/sdks/react/), and the source is in [`sdks/react`](https://github.com/wizzywit/odudu/tree/main/sdks/react).

License: Apache-2.0.
