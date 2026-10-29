import { mailBrandingViewSchema, type MailBrandingView } from '@odudu/contracts/admin';
import { adminCall, segment } from '#/shared/adapter/route';
import { GATEWAY_BASE, type Gateway, type GatewayResult } from '#/shared/transport/gateway';
import type { MailChoice } from '#/features/branding/service';

// The tenant's own, or that of the client whose row id is given.
export function readMailBranding(
  gateway: Gateway,
  tenant: string,
  client: string,
): Promise<GatewayResult<MailBrandingView>> {
  if (client === '') {
    return adminCall(gateway, 'GET', tenant, ['mail', 'branding'], {
      schema: mailBrandingViewSchema,
    });
  }
  return adminCall(gateway, 'GET', tenant, ['clients', client, 'mail', 'branding'], {
    schema: mailBrandingViewSchema,
  });
}

// The mail the frame shows, fetched by the frame itself under the session
// cookie; no language asks for the tenant's default.
export function mailPreviewSource(tenant: string, choice: MailChoice): string {
  const tail = choice.client === '' ? [] : ['clients', choice.client];
  const path = ['admin', 'tenants', tenant, ...tail, 'mail', 'preview'].map(segment).join('/');
  const query = new URLSearchParams({ scheme: choice.scheme });
  if (choice.locale !== '') query.set('locale', choice.locale);
  return `${GATEWAY_BASE}${path}?${query.toString()}`;
}
