# @odudu-io/me-client

This package calls the me API: the operations a signed-in person makes about their own account under `/tenants/{tenant}/me`. It is built the same way as [`@odudu-io/admin-client`](https://wizzywit.github.io/odudu/docs/sdks/admin-client/), from the me API's OpenAPI document, and shares its behavior for the tenant, retries, iteration and errors.

## Install

```text
npm install @odudu-io/me-client
```

It needs Node 24 or later and depends on `openapi-fetch`. The token for it comes from a person's sign-in with [`@odudu-io/oidc`](https://wizzywit.github.io/odudu/docs/sdks/oidc/), which the example below imports: install it too.

## The shortest use

This is the second half of [the admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin). A person signs in at a loopback address, as a command-line tool does, and the script reads their profile. The sign-in asks for the person's own account with `meAccess: 'read'`, and the access token for it is filed under the me audience, the issuer's address plus `/me`. The client the person signs in with must be registered with that audience (`odudu seed client --audience <issuer>/me`). It also needs the scope `me:read` assigned, and `me:write` to write. An administrator assigns it, and `odudu seed client --allow-action <action>` assigns `me:read` as well (the example's `provision.sh` relies on that).

```ts
import { createMeClient } from '@odudu-io/me-client';
import { beginSignIn, completeSignIn } from '@odudu-io/oidc';

const base = 'https://id.example.com';
const issuer = `${base}/tenants/acme`;

const { url, pending } = await beginSignIn({
  issuer,
  clientId: 'my-cli',
  redirectUri: 'http://127.0.0.1:8086/callback',
  scope: 'openid',
  meAccess: 'read',
});
console.log(`Open ${url} to sign in.`);

// Your code waits for the redirect to reach the loopback address and gives the
// whole address it arrived at to completeSignIn.
declare function waitForCallback(): Promise<string>;
const tokens = await completeSignIn(await waitForCallback(), pending);

const meToken = tokens.byAudience[`${issuer}/me`]?.accessToken;
if (meToken === undefined) throw new Error('no token for the me API came back');

const me = createMeClient({ baseUrl: base, tenant: 'acme', token: meToken });
const profile = await me.GET('/tenants/{tenant}/me/profile');
console.log(`profile: ${profile.data.username}`);
```

## More

The full reference is on the [documentation site](https://wizzywit.github.io/odudu/docs/sdks/me-client/), and the source is in [`sdks/me-client`](https://github.com/wizzywit/odudu/tree/main/sdks/me-client).

License: Apache-2.0.
