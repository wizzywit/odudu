import { createMeClient, iterate, type MeError } from '#/index';

const client = createMeClient({ baseUrl: 'http://x', tenant: 'acme', token: 't' });

// The tenant is the client's: no `params` is needed for the profile.
export const profile = client.GET('/tenants/{tenant}/me/profile');

// @ts-expect-error a path the document does not have
export const unknownPath = client.GET('/tenants/{tenant}/me/nothing');

// A call cannot name its own origin or redirect policy.
// @ts-expect-error baseUrl is the client's
export const ownOrigin = client.GET('/tenants/{tenant}/me/profile', { baseUrl: 'http://evil' });
// @ts-expect-error redirect policy is the client's
export const ownRedirect = client.GET('/tenants/{tenant}/me/profile', { redirect: 'follow' });

export async function profileName(): Promise<string | null> {
  const { data } = await client.GET('/tenants/{tenant}/me/profile');
  return data.name;
}

export async function sessionIds(): Promise<string[]> {
  const ids: string[] = [];
  for await (const session of iterate((page) =>
    client.GET('/tenants/{tenant}/me/sessions', { params: { query: page } }),
  )) {
    ids.push(session.id);
  }
  return ids;
}

export const refusal: MeError['error'] = 'not_found';
