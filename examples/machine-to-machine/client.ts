// A service that signs in as itself and calls an API. Keep the secret in your
// platform's secret store, not in code.
import { createTokenSource, OduduError } from '@odudu-io/oidc';

const BASE = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const API_URL = process.env.API_URL ?? 'http://localhost:8082';

// Gives the token it holds until it is nearly expired, then asks again with the
// credentials the service already has. Calls that arrive together share one
// request. `allowInsecureRequests` lets it talk to an http issuer; never set it
// in production.
const token = createTokenSource(
  {
    issuer: `${BASE}/tenants/${process.env.TENANT ?? 'demo'}`,
    clientId: process.env.CLIENT_ID ?? 'example-m2m',
    // A published value for the local example stack; never reuse it anywhere real.
    auth: { secret: process.env.CLIENT_SECRET ?? 'example-m2m-secret' },
    scope: 'reports:read',
  },
  { allowInsecureRequests: true },
);

try {
  const reports = await fetch(`${API_URL}/reports`, {
    headers: { authorization: `Bearer ${await token()}` },
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`API answered ${reports.status}: ${await reports.text()}`);
  if (!reports.ok) process.exit(1);
} catch (error) {
  console.error(error instanceof OduduError ? `${error.code}: ${error.message}` : String(error));
  process.exit(1);
}
