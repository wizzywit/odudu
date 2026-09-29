export async function loadClients(): Promise<unknown> {
  const response = await fetch('/console/api/admin/clients');
  return response.json();
}

export async function loadScopes(): Promise<Response> {
  return globalThis.fetch('/console/api/admin/scopes');
}
