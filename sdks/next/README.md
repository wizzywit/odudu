# @odudu-io/next

This package binds [`@odudu-io/bff`](https://wizzywit.github.io/odudu/docs/sdks/bff/) to the Next.js App Router. One call makes the route handlers that run the sign-in, the session and the proxy, and a server-side `getSession()` that returns the claims of the signed-in person. The server keeps the tokens in a session store and the browser holds only an `HttpOnly` cookie with an opaque id.

## Install

```text
npm install @odudu-io/next
```

It needs Next 16 and React 19 (peer dependencies), and Node 24 or later. It depends on [`@odudu-io/bff`](https://wizzywit.github.io/odudu/docs/sdks/bff/).

## The shortest use

This is [the Next.js example](https://github.com/wizzywit/odudu/tree/main/examples/next), trimmed. Create the handlers once.

```ts
// lib/odudu.ts
import { createOduduHandlers } from '@odudu-io/next';

const origin = 'https://app.example.com';

export const { GET, POST, PUT, PATCH, DELETE, getSession } = createOduduHandlers({
  issuer: 'https://id.example.com/tenants/acme',
  clientId: 'my-app',
  clientSecret: process.env.CLIENT_SECRET ?? '',
  redirectUri: `${origin}/api/auth/callback`,
  postLogoutRedirectUri: `${origin}/`,
  scope: 'openid profile',
});
```

Export the methods from a catch-all route, so that `/api/auth/login`, `/callback`, `/logout`, `/session` and `/proxy/...` answer.

```ts
// app/api/auth/[...odudu]/route.ts
export { GET, POST, PUT, PATCH, DELETE } from '../../../../lib/odudu';
```

## More

The full reference is on the [documentation site](https://wizzywit.github.io/odudu/docs/sdks/next/), and the source is in [`sdks/next`](https://github.com/wizzywit/odudu/tree/main/sdks/next).

License: Apache-2.0.
