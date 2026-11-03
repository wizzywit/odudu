import type { QueryClient } from '@tanstack/react-query';
import { loadDrafts } from '#/shared/api/adapter/draftStorage';
import { useDrafts } from '#/shared/lib/repository/useDrafts';
import { recordKey } from '#/shared/lib/repository/queryKeys';
import type { RecordEntry } from '#/shared/lib/repository/useRecord';
import { TENANT_SETTINGS_RECORD } from '#/entities/tenant';

// What a session ending mid-edit would keep in the browser, as text.
export function draftsKept(owner: string): { sections: number; stored: string } {
  const sections = useDrafts.getState().keepDirty(owner);
  return { sections, stored: JSON.stringify(loadDrafts()) };
}

// The ETag the cached settings record carries, whoever saved it last.
export function cachedSettingsEtag(client: QueryClient, tenant: string): string | null {
  const entry = client.getQueryData<RecordEntry<unknown>>(
    recordKey(tenant, TENANT_SETTINGS_RECORD),
  );
  return entry?.result.etag ?? null;
}
