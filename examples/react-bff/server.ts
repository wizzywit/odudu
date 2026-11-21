// Serves the built page and the BFF's routes from one origin, so the session
// cookie is first-party. For the example the server listens on plain http and
// `allowInsecureRequests` lets the SDK talk to an http issuer; a production
// server needs HTTPS and a session store shared by its instances.
import express from 'express';
import { createBff } from '@odudu-io/bff';
import { bffRouter } from '@odudu-io/bff/express';

const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const PORT = Number(process.env.PORT ?? 8083);
const ORIGIN = `http://localhost:${PORT}`;

const bff = createBff({
  issuer: `${BASE}/tenants/${process.env.TENANT ?? 'demo'}`,
  clientId: process.env.CLIENT_ID ?? 'example-react-bff',
  // A published value for the local example stack; never reuse it anywhere real.
  clientSecret: process.env.CLIENT_SECRET ?? 'example-react-bff-secret',
  redirectUri: `${ORIGIN}/bff/callback`,
  postLogoutRedirectUri: `${ORIGIN}/`,
  scope: 'openid profile',
  deps: { allowInsecureRequests: true },
});

const app = express();
// The router goes first: the BFF reads each request itself, so no body parser
// may run before it.
app.use(bffRouter(bff, { prefix: '/bff' }));
app.use(express.static('dist'));

app.listen(PORT, () => {
  console.log(`React app and BFF on ${ORIGIN}`);
});
