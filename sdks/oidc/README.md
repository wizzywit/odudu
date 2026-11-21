# @odudu-io/oidc

This is the core the other SDKs are built on. It makes the sign-in request for the authorization code flow with PKCE, checks the answer, renews tokens, signs a service in as itself and builds the address that ends a session. It keeps nothing: you hold the tokens and the short record a sign-in needs between the redirect out and the redirect back.

## Install

```text
npm install @odudu-io/oidc
```

It needs Node 24 or later, or a browser or edge runtime. Its two dependencies are `oauth4webapi` and `jose`.

## The shortest use

A single-page app starts a sign-in, keeps the record the redirect needs, and finishes the sign-in when the browser returns. This is the code of [the single-page app example](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app), trimmed.

```ts
import { beginSignIn, completeSignIn, signOutUrl, type Pending } from '@odudu-io/oidc';

const issuer = 'https://id.example.com/tenants/acme';

// 1. On the sign-in button: build the address and send the browser there.
const { url, pending } = await beginSignIn({
  issuer,
  clientId: 'my-app',
  redirectUri: `${location.origin}/callback`,
  scope: 'openid profile',
});
sessionStorage.setItem('pending', JSON.stringify(pending));
location.assign(url);

// 2. On /callback: use the record once, then finish the sign-in.
const stored = sessionStorage.getItem('pending');
sessionStorage.removeItem('pending');
const tokens = await completeSignIn(location.href, JSON.parse(stored ?? '{}') as Pending);
console.log(tokens.claims.sub);

// 3. On sign-out: forget the tokens and send the browser to Odudu.
location.assign(
  await signOutUrl({
    issuer,
    idToken: tokens.idToken,
    postLogoutRedirectUri: `${location.origin}/`,
  }),
);
```

## More

The full reference is on the [documentation site](https://wizzywit.github.io/odudu/docs/sdks/oidc/), and the source is in [`sdks/oidc`](https://github.com/wizzywit/odudu/tree/main/sdks/oidc).

License: Apache-2.0.
