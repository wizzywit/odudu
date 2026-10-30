import type { PublishThemeResponse, PutThemeRequest, ThemeView } from '@odudu/contracts/admin';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import {
  discardThemeDraft,
  publishTheme,
  putTheme,
  resetTheme,
  restoreVersion,
} from '#/features/branding/adapter/theme';
import {
  scopeKeyPart,
  themeRecord,
  writesRunning,
  type ThemeScope,
  type WritesRunning,
} from '#/features/branding/service';
import { useRecordSaving } from '#/shared/repository/useSavingSections';
import {
  recordKey,
  themeVersionsKey,
  themeWriteKey,
  themeWritesKey,
} from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import type { RecordEntry } from '#/shared/repository/useRecord';
import { useGatewayWrite, type Write } from '#/shared/repository/useWrite';
import { isStale } from '#/shared/service/failure';
import type { GatewayResult, GatewaySuccess } from '#/shared/transport/gateway';

// The draft written again whole, on the tag it was read with.
export interface Revert {
  body: PutThemeRequest;
  tag: string;
}

export interface ThemeWrites {
  publish: Write<string, GatewayResult<PublishThemeResponse>>;
  discard: Write<string, GatewayResult<ThemeView>>;
  revert: Write<Revert, GatewayResult<ThemeView>>;
  restore: Write<string, GatewayResult<ThemeView>>;
  reset: Write<void, GatewayResult<ThemeView>>;
}

// Publishing, restoring, resetting, discarding and reverting each answer the
// theme as it now stands, which replaces the record so the sections rebase on
// it; all but the last two change the versions list.
export function useThemeWrites(tenant: string, scope: ThemeScope): ThemeWrites {
  const client = useQueryClient();
  const { invalidate, invalidateExact } = useInvalidate();
  const key = recordKey(tenant, themeRecord(scope));
  const versions = themeVersionsKey(tenant, scopeKeyPart(scope));
  const named = (write: string) => themeWriteKey(tenant, scopeKeyPart(scope), write);
  const keep = (result: GatewaySuccess<ThemeView>): void => {
    client.setQueryData<RecordEntry<ThemeView>>(key, { result, by: 'save' });
    invalidate(versions);
  };
  // A write of the draft alone leaves the versions as they are; a draft it
  // found moved on is read again.
  const replaceDraft = (result: GatewayResult<ThemeView>): void => {
    if (result.ok) client.setQueryData<RecordEntry<ThemeView>>(key, { result, by: 'save' });
    else if (isStale(result)) invalidateExact(key);
  };
  return {
    publish: useGatewayWrite({
      mutationKey: named('publish'),
      send: (gateway, tag: string) => publishTheme(gateway, tenant, scope, tag),
      onSuccess: (result) => {
        if (result.ok) keep(result);
        else if (isStale(result)) invalidateExact(key);
      },
    }),
    discard: useGatewayWrite({
      mutationKey: named('discard'),
      send: (gateway, tag: string) => discardThemeDraft(gateway, tenant, scope, tag),
      onSuccess: replaceDraft,
    }),
    revert: useGatewayWrite({
      mutationKey: named('revert'),
      send: (gateway, { body, tag }: Revert) => putTheme(gateway, tenant, scope, body, tag),
      onSuccess: replaceDraft,
    }),
    restore: useGatewayWrite({
      mutationKey: named('restore'),
      send: (gateway, versionId: string) => restoreVersion(gateway, tenant, scope, versionId),
      onSuccess: (result) => {
        if (result.ok) keep(result);
      },
    }),
    reset: useGatewayWrite({
      mutationKey: named('reset'),
      send: (gateway) => resetTheme(gateway, tenant, scope),
      onSuccess: (result) => {
        if (result.ok) keep(result);
      },
    }),
  };
}

// Which writes to this scope's theme are running anywhere on the page, not
// only the ones this part started. `every` counts the tenant's theme writes of
// every scope, so a write to a client's theme also holds a tenant's bar for
// its duration: a short, harmless hold for two scopes that are never edited
// at once, and cheaper than keying every write by its scope.
export function useThemeRunning(tenant: string, scope: ThemeScope): WritesRunning {
  const part = scopeKeyPart(scope);
  const publish = useIsMutating({ mutationKey: themeWriteKey(tenant, part, 'publish') });
  const discard = useIsMutating({ mutationKey: themeWriteKey(tenant, part, 'discard') });
  const revert = useIsMutating({ mutationKey: themeWriteKey(tenant, part, 'revert') });
  const every = useIsMutating({ mutationKey: themeWritesKey(tenant) });
  const sections = useRecordSaving(tenant, themeRecord(scope));
  return writesRunning({ publish, discard, revert, every, sections });
}
