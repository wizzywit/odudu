import { createAdminClient, iterate, type ProblemDetails, type ProblemError } from '#/index';

const client = createAdminClient({ baseUrl: 'http://x', tenant: 'acme', token: 't' });

// The tenant is not a path parameter of the surface: no `params` at all.
export const listClients = client.GET('/admin/tenants/{tenant}/clients');
export const listWithQuery = client.GET('/admin/tenants/{tenant}/clients', {
  params: { query: { limit: 10, cursor: 'c' } },
});

// Other path parameters stay required.
export const getClient = client.GET('/admin/tenants/{tenant}/clients/{id}', {
  params: { path: { id: 'c1' } },
});
// @ts-expect-error the id is still required
export const missingId = client.GET('/admin/tenants/{tenant}/clients/{id}');
// @ts-expect-error a path the document does not have
export const unknownPath = client.GET('/admin/nothing');
// @ts-expect-error a method the path does not have
export const wrongMethod = client.DELETE('/admin/tenants/{tenant}/clients');

// A request body is still required where the document requires one.
// @ts-expect-error `username` is required
export const noBody = client.POST('/admin/tenants/{tenant}/subjects', { body: {} });
export const created = client.POST('/admin/tenants/{tenant}/subjects', {
  body: { username: 'ada' },
});

// The success body is what a caller gets; there is no error branch to narrow.
export async function usernames(): Promise<(string | null)[]> {
  const { data } = await client.GET('/admin/tenants/{tenant}/subjects');
  return data.items.map((subject) => subject.username);
}

// A page of items arrives typed as the document declares it.
export async function firstClientId(): Promise<string | undefined> {
  for await (const item of iterate((page) =>
    client.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
  )) {
    return item.client_id;
  }
  return undefined;
}
// @ts-expect-error the client id is a string, not a number
export const clientIdAsNumber: Promise<number | undefined> = firstClientId();

// The error type carries the document's problem details.
export function fieldErrors(error: ProblemError): ProblemDetails['errors'] {
  return error.errors;
}
export const status: ProblemDetails['status'] = 400;
