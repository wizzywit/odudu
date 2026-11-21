# @odudu-io/node

This package decides, in your API and without asking Odudu on each request, whether to trust an access token. It checks the signature against the tenant's published keys, the issuer, the audience, the token type, the expiry and, if you ask, a required scope, and it answers a refusal with the status and the `WWW-Authenticate` challenge RFC 6750 describes.

## Install

```text
npm install @odudu-io/node
```

It needs Node 24 or later and depends on `jose`. Express 5 and Fastify 5 are optional peer dependencies: the package root and `@odudu-io/node/http` need neither, and `@odudu-io/node/fastify` needs `fastify` installed.

## The shortest use

This is [the API example](https://github.com/wizzywit/odudu/tree/main/examples/api), trimmed. It protects one route of a plain `http` server.

```ts
import { createServer } from 'node:http';
import { createVerifier } from '@odudu-io/node';
import { withToken } from '@odudu-io/node/http';

const verifier = createVerifier({
  issuers: ['https://id.example.com/tenants/acme'],
  audience: 'https://api.example.com',
});

// A valid token without the scope is a 403: the caller is known and not allowed.
// A 401 means the token itself is not trusted.
const reports = withToken(
  verifier,
  (_request, response, token) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ caller: token.clientId ?? token.sub }));
  },
  { scope: 'reports:read', onError: (error) => console.error(String(error)) },
);

createServer((request, response) => {
  if (request.url === '/reports') return reports(request, response);
  response.writeHead(404).end();
}).listen(8082);
```

## More

The full reference is on the [documentation site](https://wizzywit.github.io/odudu/docs/sdks/node/), and the source is in [`sdks/node`](https://github.com/wizzywit/odudu/tree/main/sdks/node).

License: Apache-2.0.
