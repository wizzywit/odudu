import {
  publishThemeResponseSchema,
  themeViewSchema,
  listThemeVersionsResponseSchema,
  type PutThemeRequest,
} from '@odudu/contracts/admin';
import { adminCall } from '#/shared/adapter/route';
import { staleWhenTagMissing } from '#/shared/services/failure';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { ifMatchOf, tagOf, type ThemeScope } from '#/features/branding/services/themeScope';
import type { PublishThemeResponse, ThemeView } from '#/features/branding/types/theme';
import type { ThemeVersions } from '#/features/branding/types/themeVersion';

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

// Only the draft goes: the published theme and its versions stay.
export async function discardThemeDraft(
  gateway: Gateway,
  tenant: string,
  scope: ThemeScope,
  tag: string,
): Promise<GatewayResult<ThemeView>> {
  const ifMatch = ifMatchOf(tag);
  const options = { ...(ifMatch === undefined ? {} : { ifMatch }), schema: themeViewSchema };
  return tagged(
    staleWhenTagMissing(
      scope.kind === 'tenant'
        ? await adminCall(gateway, 'DELETE', tenant, ['theme', 'draft'], options)
        : await adminCall(
            gateway,
            'DELETE',
            tenant,
            ['clients', scope.id, 'theme', 'draft'],
            options,
          ),
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
): Promise<GatewayResult<ThemeVersions>> {
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
