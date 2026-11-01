import { THEME_VERSIONS_LIMIT, type ListThemeVersionsResponse } from '@odudu/contracts/admin';
import { formatAbsolute } from '#/shared/service/format';
import type { ThemeScope } from '#/features/branding/service/scope';

type Version = ListThemeVersionsResponse['items'][number];

export const VERSIONS_TITLE = 'Versions';

export function versionsLead(): string {
  return `The published version and the ${String(THEME_VERSIONS_LIMIT - 1)} before it, newest first. Restoring one publishes a copy of it as the next version and leaves your draft alone.`;
}

export const NO_VERSIONS = 'Nothing has been published yet.';

export interface VersionRow {
  id: string;
  name: string;
  state: Version['state'];
  tone: 'active' | 'neutral';
  when: string;
  // Restoring the version people already see changes nothing.
  restorable: boolean;
}

export function versionRows(items: readonly Version[]): readonly VersionRow[] {
  return items.map((item) => ({
    id: item.id,
    name: `Version ${String(item.version)}`,
    state: item.state,
    tone: item.state === 'published' ? 'active' : 'neutral',
    when: formatAbsolute(new Date(item.published_at ?? item.created_at)),
    restorable: item.state !== 'published',
  }));
}

export function restoreTitle(row: VersionRow): string {
  return `Restore ${row.name}?`;
}

export function restoreBody(row: VersionRow): string {
  return `${row.name} is published again, as a new version, and people see it at once. Your saved draft is not changed.`;
}

export const RESTORED_TOAST = 'Version restored';

export const RESET_TITLE = 'Reset to default';

export function resetLead(scope: ThemeScope): string {
  return scope.kind === 'tenant'
    ? 'Returns the tenant to Instrument’s own look.'
    : 'Returns the client to its tenant’s look.';
}

export function resetBody(scope: ThemeScope): string {
  const back = scope.kind === 'tenant' ? 'Instrument’s own pages' : 'its tenant’s theme';
  return `Deletes the draft and unpublishes the theme, so people see ${back} again. The version that was published stays in Versions, and you can restore it.`;
}

export const RESET_CONFIRM = 'Reset to default';

export const RESET_DONE = 'Reset to the default theme';

export const VERSIONS_FAILED = 'The versions could not be loaded';
