import { messageCatalogueResponseSchema } from '@odudu/contracts/admin';
import { adminCall } from '#/shared/api/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import type { MessageCatalogue } from '#/features/branding-editor/types/messageCatalogue';

// The keys a template or an override may name, with their English text.
export function readMessageCatalogue(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<MessageCatalogue>> {
  return adminCall(gateway, 'GET', tenant, ['message-catalogue'], {
    schema: messageCatalogueResponseSchema,
  });
}
