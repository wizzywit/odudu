# @odudu-io/bff

This package is the server half of the backend for frontend pattern in RFC 10017 ([what the pattern is and when to choose it](https://wizzywit.github.io/odudu/docs/concepts/backend-for-frontend/)). A server you run is the OAuth client: it signs the person in, keeps the tokens in a session store, and gives the browser a cookie that holds an opaque id and nothing else. Its handlers are built on `Request` and `Response`, so the Express and Fastify adapters are thin, and [`@odudu-io/next`](https://wizzywit.github.io/odudu/docs/sdks/next/) builds on it.

## Install

```text
npm install @odudu-io/bff
```

It needs Node 24 or later and depends on [`@odudu-io/oidc`](https://wizzywit.github.io/odudu/docs/sdks/oidc/). Express 5 and Fastify 5 are optional peer dependencies: install the one whose adapter you import.

## The shortest use

This is the server of [the React and BFF example](https://github.com/wizzywit/odudu/tree/main/examples/react-bff), trimmed. The BFF is a confidential client and holds the secret.

```ts
import express from 'express';
import { createBff } from '@odudu-io/bff';
import { bffRouter } from '@odudu-io/bff/express';

const origin = 'https://app.example.com';

const bff = createBff({
  issuer: 'https://id.example.com/tenants/acme',
  clientId: 'my-app',
  clientSecret: process.env.CLIENT_SECRET ?? '',
  redirectUri: `${origin}/bff/callback`,
  postLogoutRedirectUri: `${origin}/`,
  scope: 'openid profile',
  // The routes live under /bff and the proxy at /bff/proxy.
  mountPath: '/bff',
});

const app = express();
// The router goes first: the BFF reads each request itself, so no body parser
// may run before it.
app.use(bffRouter(bff));
app.listen(3000);
```

## More

The full reference is on the [documentation site](https://wizzywit.github.io/odudu/docs/sdks/bff/), and the source is in [`sdks/bff`](https://github.com/wizzywit/odudu/tree/main/sdks/bff).

License: Apache-2.0.
