import {
  listMessageOverridesResponseSchema,
  messageCatalogueResponseSchema,
  type MessageCatalogueResponse,
  messageOverrideSchema,
  type MessageOverride,
} from '@odudu/contracts/admin';
import { adminCall, nothing } from '#/shared/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';

// One page of a language's overrides, in key order, from the cursor in `query`.
export function readOverridePage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<{ items: readonly MessageOverride[]; next?: string | undefined }>> {
  return adminCall(gateway, 'GET', tenant, ['message-overrides'], {
    query,
    schema: listMessageOverridesResponseSchema,
  });
}

// The most pages a language's overrides fill: the tenant holds at most 500
// across every language, and the server pages at most 200.
const MOST_PAGES = 3;
const FULL_PAGE = 200;

// One override as the server holds it now, or null when it holds none. There
// is no read of a single key, so the language is read a page at a time.
export async function readOverride(
  gateway: Gateway,
  tenant: string,
  input: { locale: string; key: string },
): Promise<GatewayResult<MessageOverride | null>> {
  let cursor: string | undefined;
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const query = new URLSearchParams({ locale: input.locale, limit: String(FULL_PAGE) });
    if (cursor !== undefined) query.set('cursor', cursor);
    const result = await readOverridePage(gateway, tenant, query);
    if (!result.ok) return result;
    const found = result.data.items.find((item) => item.key === input.key);
    if (found !== undefined) return { ...result, data: found };
    cursor = result.data.next;
    if (cursor === undefined) return { ...result, data: null };
  }
  return { ok: false, kind: 'defect' };
}

// A create names no version and says so with `etag: null`; a change names the
// version it read.
export function putOverride(
  gateway: Gateway,
  tenant: string,
  input: { locale: string; key: string; message: string; etag: string | null },
): Promise<GatewayResult<MessageOverride>> {
  return adminCall(gateway, 'PUT', tenant, ['message-overrides', input.locale, input.key], {
    body: { message: input.message },
    ...(input.etag === null ? { ifNoneMatch: '*' } : { ifMatch: input.etag }),
    schema: messageOverrideSchema,
  });
}

export function deleteOverride(
  gateway: Gateway,
  tenant: string,
  input: { locale: string; key: string; etag: string },
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['message-overrides', input.locale, input.key], {
    ifMatch: input.etag,
    schema: nothing,
  });
}

// The keys a template or an override may name, with their English text.
export function readMessageCatalogue(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<MessageCatalogueResponse>> {
  return adminCall(gateway, 'GET', tenant, ['message-catalogue'], {
    schema: messageCatalogueResponseSchema,
  });
}
