import type { ThemeVersions } from '#/features/branding-editor/types/themeVersion';
import { THEME_VERSIONS_LIMIT } from '@odudu/contracts/admin';
import { formatAbsolute } from '#/shared/lib/services/format';
import type { Read } from '#/shared/lib/services/read';
import type { ThemeScope } from '#/features/branding-editor/services/themeScope';

type Version = ThemeVersions['items'][number];

const VERSIONS_TITLE = 'Versions';

export function versionsLead(): string {
  return `The published version and the ${String(THEME_VERSIONS_LIMIT - 1)} before it, newest first. Restoring one publishes a copy of it as the next version and leaves your draft alone.`;
}

const NO_VERSIONS = 'Nothing has been published yet.';

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

const RESET_TITLE = 'Reset to default';

function resetLead(scope: ThemeScope): string {
  return scope.kind === 'tenant'
    ? 'Returns the tenant to Instrument’s own look.'
    : 'Returns the client to its tenant’s look.';
}

export function resetBody(scope: ThemeScope): string {
  const back = scope.kind === 'tenant' ? 'Instrument’s own pages' : 'its tenant’s theme';
  return `Deletes the draft and unpublishes the theme, so people see ${back} again. The version that was published stays in Versions, and you can restore it.`;
}

const RESET_CONFIRM = 'Reset to default';

export const RESET_DONE = 'Reset to the default theme';

const VERSIONS_FAILED = 'The versions could not be loaded';

const RESTORE_LABEL = 'Restore';

const RESET_LABEL = 'Reset to default…';

export function restoreName(version: string): string {
  return `Restore ${version}`;
}

const VERSIONS_COLUMNS = {
  version: 'Version',
  state: 'State',
  when: 'Published',
  action: 'Action',
} as const;

const VERSIONS_TABLE_LABEL = 'Theme versions';

export interface VersionLine extends VersionRow {
  restoreName: string;
}

export interface VersionsWords {
  title: string;
  lead: string;
  loading: string;
  failed: string;
  tableLabel: string;
  columns: typeof VERSIONS_COLUMNS;
  empty: string;
  restoreLabel: string;
}

export const VERSIONS_WORDS: VersionsWords = {
  title: VERSIONS_TITLE,
  lead: versionsLead(),
  loading: 'Loading the versions',
  failed: VERSIONS_FAILED,
  tableLabel: VERSIONS_TABLE_LABEL,
  columns: VERSIONS_COLUMNS,
  empty: NO_VERSIONS,
  restoreLabel: RESTORE_LABEL,
};

// The rows to list once the versions are read, none before.
export function versionLines(read: Read<ThemeVersions>): VersionLine[] {
  return read.status === 'ready'
    ? versionRows(read.data.items).map((row) => ({ ...row, restoreName: restoreName(row.name) }))
    : [];
}

// The confirmation of restoring the version asked about, empty while none is.
export function restoreDialog(asked: VersionRow | null): {
  title: string;
  consequence: string;
  confirmLabel: string;
} {
  return {
    title: asked === null ? '' : restoreTitle(asked),
    consequence: asked === null ? '' : restoreBody(asked),
    confirmLabel: RESTORE_LABEL,
  };
}

export interface ResetWords {
  title: string;
  lead: string;
  label: string;
  dialog: { title: string; consequence: string; confirmLabel: string };
}

export function resetWords(scope: ThemeScope): ResetWords {
  return {
    title: RESET_TITLE,
    lead: resetLead(scope),
    label: RESET_LABEL,
    dialog: {
      title: `${RESET_TITLE}?`,
      consequence: resetBody(scope),
      confirmLabel: RESET_CONFIRM,
    },
  };
}
