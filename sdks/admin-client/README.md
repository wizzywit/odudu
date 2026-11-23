# @odudu-io/admin-client

This package calls the admin API of one tenant from code. Its paths and types are generated from the admin API's OpenAPI document, so a call you write is checked against the API's own routes, and a client built from it cannot send its token to another origin.

## Install

```text
npm install @odudu-io/admin-client
```

It needs Node 24 or later and depends on `openapi-fetch`. To get a token as a service, use the token source of [`@odudu-io/oidc`](https://wizzywit.github.io/odudu/docs/sdks/oidc/), which the example below imports: install it too.

## The shortest use

This is the first half of [the admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin). A service signs in as itself, makes a client, walks the tenant's clients and deletes the one it made.

```ts
import { createAdminClient, iterate } from '@odudu-io/admin-client';
import { createTokenSource } from '@odudu-io/oidc';

const admin = createAdminClient({
  baseUrl: 'https://id.example.com',
  tenant: 'acme',
  token: createTokenSource({
    issuer: 'https://id.example.com/tenants/acme',
    clientId: 'my-service',
    auth: { secret: process.env.CLIENT_SECRET ?? '' },
    resource: 'urn:odudu:params:admin-api',
  }),
});

const created = await admin.POST('/admin/tenants/{tenant}/clients', {
  body: {
    client_id: 'made-from-code',
    name: 'Made from code',
    grant_types: ['client_credentials'],
  },
});

for await (const client of iterate((page) =>
  admin.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
)) {
  console.log(client.client_id);
}

await admin.DELETE('/admin/tenants/{tenant}/clients/{id}', {
  params: { path: { id: created.data.id } },
});
```

## More

The full reference is on the [documentation site](https://wizzywit.github.io/odudu/docs/sdks/admin-client/), and the source is in [`sdks/admin-client`](https://github.com/wizzywit/odudu/tree/main/sdks/admin-client).

License: Apache-2.0.
