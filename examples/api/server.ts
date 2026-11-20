// An API that trusts an access token only after checking it itself. For the
// example the API listens on plain http; a production API sits behind HTTPS.
import { createServer } from 'node:http';
import { createVerifier } from '@odudu-io/node';
import { withToken } from '@odudu-io/node/http';

const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const ISSUER = `${BASE}/tenants/${process.env.TENANT ?? 'demo'}`;
const PORT = Number(process.env.PORT ?? 8082);
// Odudu names the tenant itself as the audience unless a client says otherwise.
// RFC 9068 wants it to name this API: register the audience on the client and
// set API_AUDIENCE to it.
const AUDIENCE = process.env.API_AUDIENCE ?? ISSUER;

// Checks the signature against the tenant's published keys, the issuer, the
// audience, the token type (which keeps an ID token out) and the expiry.
// `allowInsecureIssuers` lets it trust an http issuer; never set it in production.
const verifier = createVerifier({
  issuers: [ISSUER],
  audience: AUDIENCE,
  allowInsecureIssuers: true,
});

// A valid token without the scope is a 403, because the caller is known and
// not allowed; a 401 means the token itself is not trusted.
const reports = withToken(
  verifier,
  (_request, response, token) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ caller: token.clientId ?? token.sub, reports: ['q1', 'q2'] }));
  },
  { scope: 'reports:read', onError: (error) => console.error(String(error)) },
);

createServer((request, response) => {
  if (request.url === '/reports') return reports(request, response);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ name: 'example API' }));
}).listen(PORT, () => {
  console.log(`API on port ${PORT}, trusting ${ISSUER}`);
});
