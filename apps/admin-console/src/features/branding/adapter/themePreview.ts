import { stylesheetHooksResponseSchema, themePreviewInfoSchema } from '@odudu/contracts/admin';
import { adminCall, segment } from '#/shared/adapter/route';
import { GATEWAY_BASE, type Gateway, type GatewayResult } from '#/shared/transport/gateway';
import { themeParts, type ThemeScope } from '#/features/branding/services/themeScope';
import type { PageKind } from '#/features/branding/services/pageKinds';
import type { Scheme } from '#/features/branding/services/colourScheme';
import type { StylesheetHooksResponse, ThemePreviewInfo } from '#/features/branding/types/theme';

// The page the frame shows: the real renderer's answer for the saved draft,
// fetched by the frame itself under the session cookie.
export function previewSource(
  tenant: string,
  scope: ThemeScope,
  choice: { kind: PageKind; scheme: Scheme },
): string {
  const path = ['admin', 'tenants', tenant, ...themeParts(scope), 'preview'].map(segment).join('/');
  return `${GATEWAY_BASE}${path}?${new URLSearchParams(choice).toString()}`;
}

// What a stylesheet's rules may name, which is the tenant's one list whether
// the stylesheet being edited is the tenant's or a client's.
export function readStylesheetHooks(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<StylesheetHooksResponse>> {
  return adminCall(gateway, 'GET', tenant, ['theme', 'stylesheet-hooks'], {
    schema: stylesheetHooksResponseSchema,
  });
}

// What the preview of the same request shows and why, which a frame cannot
// say itself: its headers are not readable from the page that frames it.
export function readPreviewInfo(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
  choice: { kind: PageKind; scheme: Scheme },
): Promise<GatewayResult<ThemePreviewInfo>> {
  const options = { query: new URLSearchParams(choice), schema: themePreviewInfoSchema };
  return scope.kind === 'tenant'
    ? adminCall(gateway, 'GET', tenant, ['theme', 'preview', 'info'], options)
    : adminCall(gateway, 'GET', tenant, ['clients', scope.id, 'theme', 'preview', 'info'], options);
}
