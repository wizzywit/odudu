import type { ThemeView } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useThemeRecord } from '#/features/branding/repository/useThemeRecord';
import {
  NO_OUTCOME,
  placedOver,
  TENANT_SCOPE,
  tabsChanged,
  tabsWithEdits,
  themeRecord,
  type OfferedTab,
  type PublishOutcome,
  type ThemeScope,
} from '#/features/branding/service';
import { usePreview, type Preview } from '#/features/branding/usecase/usePreview';
import { useDirtySections } from '#/shared/repository/useDirtySections';
import type { RecordState } from '#/shared/repository/useRecord';
import { TENANT_SETTINGS_RECORD } from '#/shared/service/tenantSettings';

export interface ScopeBranding {
  record: RecordState<ThemeView>;
  view: ThemeView | undefined;
  // The draft's tag, or the one that says there is none.
  tag: string | null;
  // The tabs holding part of what a publish would change, for their dots.
  changed: ReadonlySet<OfferedTab>;
  // The scope, with what the tenant supplies under it once the read says.
  scope: ThemeScope;
  preview: Preview;
  // What the last publish answered, kept here so each tab can mark its refusals.
  published: PublishOutcome;
  setPublished: (outcome: PublishOutcome) => void;
}

// One scope's theme: its record, the preview of its draft, and under a
// client the tenant's theme, which says what each of its pieces hides.
export function useScopeBranding(
  tenant: string,
  scope: ThemeScope,
  showsPreview: boolean,
): ScopeBranding {
  const record = useThemeRecord(tenant, scope);
  const placed = placedOver(scope, record.data);
  const [published, setPublished] = useState(NO_OUTCOME);
  return {
    record,
    view: record.data,
    tag: record.etag,
    changed: tabsChanged(record.data?.changed ?? []),
    scope: placed,
    preview: usePreview(tenant, placed, record.data, record.etag, showsPreview),
    published,
    setPublished,
  };
}

// The tabs of a scope's theme holding unsaved edits, for their dots.
export function useScopeEdits(tenant: string, scope: ThemeScope): ReadonlySet<OfferedTab> {
  return tabsWithEdits(useDirtySections(tenant, themeRecord(scope)));
}

// The tabs of the tenant's Branding holding unsaved edits: the theme's, and
// the languages, which save to the tenant's settings.
export function useTenantEdits(tenant: string): ReadonlySet<OfferedTab> {
  return tabsWithEdits(
    useDirtySections(tenant, themeRecord(TENANT_SCOPE)),
    useDirtySections(tenant, TENANT_SETTINGS_RECORD),
  );
}
