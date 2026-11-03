export const BRANDING_DESCRIPTION =
  'How the sign-in and account pages look to this tenant’s users. Edits are saved as a draft; nobody sees them until you publish.';

export const BRANDING_SECTIONS_LABEL = 'Branding sections';

export const BRANDING_NOUN = 'theme';

export const RESTORE_LABEL = 'Restore';

export const RESET_LABEL = 'Reset to default…';

export function restoreName(version: string): string {
  return `Restore ${version}`;
}

export const VERSIONS_COLUMNS = {
  version: 'Version',
  state: 'State',
  when: 'Published',
  action: 'Action',
} as const;

export const VERSIONS_TABLE_LABEL = 'Theme versions';

export const PAGES_LEAD =
  'Choose a page, then change its layout. The preview shows the page as people see it.';

export const PAGE_PICKER_LABEL = 'Page';

export function pickLabel(label: string): string {
  return `Pick ${label.toLowerCase()}`;
}
