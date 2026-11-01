import { type FastifyInstance, type LightMyRequestResponse } from 'fastify';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function unescapeHtml(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

// The confirmation page's hidden fields, read the way a browser submits
// them. Empty when the page is not a confirmation form.
export function confirmationFields(page: LightMyRequestResponse): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of page.body.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)) {
    fields[unescapeHtml(match[1] ?? '')] = unescapeHtml(match[2] ?? '');
  }
  return fields;
}

// Posts a confirmation page's form back and returns the answer that ends
// the session. Throws when the page carries no form to post.
export async function confirmLogoutPage(
  http: FastifyInstance,
  tenantName: string,
  cookie: string,
  page: LightMyRequestResponse,
  extraHeaders: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const fields = confirmationFields(page);
  if (fields.session_id === undefined) {
    throw new Error(`expected a confirmation page, got ${String(page.statusCode)}`);
  }
  return http.inject({
    method: 'POST',
    url: `/tenants/${tenantName}/protocol/openid-connect/logout`,
    payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, ...extraHeaders },
  });
}
