import {
  listThemeVersionsResponseSchema,
  themePreviewInfoSchema,
  stylesheetHooksResponseSchema,
  type StylesheetHooksResponse,
  type ThemePreviewInfo,
  publishThemeResponseSchema,
  themeAssetSchema,
  themeViewSchema,
  type ListThemeVersionsResponse,
  type PublishThemeResponse,
  type PutThemeRequest,
  type ThemeAsset,
  type ThemeView,
} from '@odudu/contracts/admin';
import { adminCall, nothing, segment } from '#/shared/adapter/route';
import { staleWhenTagMissing } from '#/shared/service/failure';
import { GATEWAY_BASE, type Gateway, type GatewayResult } from '#/shared/transport/gateway';
import {
  ifMatchOf,
  imageDataUrl,
  tagOf,
  themeParts,
  type PageKind,
  type Scheme,
  type ThemeScope,
} from '#/features/branding/service';

// A theme with no draft has no ETag; every answer that carries a view says so
// the same way, so a section can always save against what it was read with.
function tagged<T>(result: GatewayResult<T>): GatewayResult<T> {
  return result.ok ? { ...result, etag: tagOf(result.etag) } : result;
}

export async function readTheme(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
): Promise<GatewayResult<ThemeView>> {
  const schema = themeViewSchema;
  return tagged(
    scope.kind === 'tenant'
      ? await adminCall(gateway, 'GET', tenant, ['theme'], { schema })
      : await adminCall(gateway, 'GET', tenant, ['clients', scope.id, 'theme'], { schema }),
  );
}

// The whole draft, replaced; with no draft yet the request carries no If-Match.
export async function putTheme(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
  body: PutThemeRequest,
  tag: string,
): Promise<GatewayResult<ThemeView>> {
  const ifMatch = ifMatchOf(tag);
  const options = {
    body,
    ...(ifMatch === undefined ? { withoutTag: true } : { ifMatch }),
    schema: themeViewSchema,
  };
  return tagged(
    staleWhenTagMissing(
      scope.kind === 'tenant'
        ? await adminCall(gateway, 'PUT', tenant, ['theme'], options)
        : await adminCall(gateway, 'PUT', tenant, ['clients', scope.id, 'theme'], options),
    ),
  );
}

export async function publishTheme(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
  tag: string,
): Promise<GatewayResult<PublishThemeResponse>> {
  const ifMatch = ifMatchOf(tag);
  const options = {
    ...(ifMatch === undefined ? {} : { ifMatch }),
    schema: publishThemeResponseSchema,
  };
  return tagged(
    scope.kind === 'tenant'
      ? await adminCall(gateway, 'POST', tenant, ['theme', 'publish'], options)
      : await adminCall(
          gateway,
          'POST',
          tenant,
          ['clients', scope.id, 'theme', 'publish'],
          options,
        ),
  );
}

export async function resetTheme(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
): Promise<GatewayResult<ThemeView>> {
  const schema = themeViewSchema;
  return tagged(
    scope.kind === 'tenant'
      ? await adminCall(gateway, 'DELETE', tenant, ['theme'], { schema })
      : await adminCall(gateway, 'DELETE', tenant, ['clients', scope.id, 'theme'], { schema }),
  );
}

export function readVersions(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
): Promise<GatewayResult<ListThemeVersionsResponse>> {
  const schema = listThemeVersionsResponseSchema;
  return scope.kind === 'tenant'
    ? adminCall(gateway, 'GET', tenant, ['theme', 'versions'], { schema })
    : adminCall(gateway, 'GET', tenant, ['clients', scope.id, 'theme', 'versions'], { schema });
}

export async function restoreVersion(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
  versionId: string,
): Promise<GatewayResult<ThemeView>> {
  const schema = themeViewSchema;
  return tagged(
    scope.kind === 'tenant'
      ? await adminCall(gateway, 'POST', tenant, ['theme', 'versions', versionId, 'restore'], {
          schema,
        })
      : await adminCall(
          gateway,
          'POST',
          tenant,
          ['clients', scope.id, 'theme', 'versions', versionId, 'restore'],
          { schema },
        ),
  );
}

// The image is the request body, and `kind` says which slot it is for.
export function uploadAsset(
  gateway: Gateway,
  tenant: string,
  kind: string,
  file: Blob,
): Promise<GatewayResult<ThemeAsset>> {
  return adminCall(gateway, 'POST', tenant, ['theme', 'assets'], {
    query: new URLSearchParams({ kind }),
    file,
    schema: themeAssetSchema,
  });
}

// What the admin sees of an uploaded image before any public address serves
// it: its bytes, as a data address a page under this console's policy may show.
export async function readAssetImage(
  gateway: Gateway,
  tenant: string,
  assetId: string,
): Promise<GatewayResult<string>> {
  const result = await gateway.bytes(
    'GET',
    `admin/tenants/${segment(tenant)}/theme/assets/${segment(assetId)}/content`,
  );
  if (!result.ok) return result;
  const url = imageDataUrl(result.data.bytes, result.data.contentType);
  return url === null ? { ok: false, kind: 'schema' } : { ...result, data: url };
}

export function deleteAsset(
  gateway: Gateway,
  tenant: string,
  assetId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['theme', 'assets', assetId], { schema: nothing });
}

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
