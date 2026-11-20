import { createOduduHandlers } from '@odudu-io/next';

const base = process.env.ODUDU_BASE ?? 'http://localhost:3000';
const tenant = process.env.TENANT ?? 'demo';
const origin = process.env.APP_ORIGIN ?? 'http://localhost:8085';

export const { GET, POST, PUT, PATCH, DELETE, getSession } = createOduduHandlers({
  issuer: `${base}/tenants/${tenant}`,
  clientId: 'example-next',
  clientSecret: 'example-next-secret',
  redirectUri: `${origin}/api/auth/callback`,
  postLogoutRedirectUri: `${origin}/`,
  scope: 'openid profile offline_access',
  deps: { allowInsecureRequests: base.startsWith('http://') },
});
