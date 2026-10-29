export const BRANDING_TITLE = 'Branding';

export const BRANDING_DESCRIPTION =
  'How the sign-in and account pages look to this tenant’s users. Edits are saved as a draft; nobody sees them until you publish.';

export const BRANDING_SECTIONS_LABEL = 'Branding sections';

export const BRANDING_NOUN = 'theme';

export const COLOURS_LEAD =
  'Light and dark are two palettes, each used whole: customise one and every colour in it is yours, so a colour can never be left to clash. A scheme you leave alone keeps Instrument’s own colours.';

export const FONT_LABEL = 'Font';

export function customLabel(scheme: string): string {
  return `Use my own ${scheme} colours`;
}

export function paletteLegend(scheme: string): string {
  return `${scheme} colours`;
}

export const CONTRAST_TITLE = 'Contrast';

export const CONTRAST_LEAD =
  'Text must reach 4.5:1 against what it sits on, and borders and the focus ring 3:1. Publishing is refused while a pair falls short. This is checked as you type.';

export const PAIR_PASSES = 'passes';

export const PAIR_FAILS = 'fails';

export const IMAGES_LEAD =
  'Images are stored as soon as they are uploaded, and used only once the draft that names them is published.';

export const UPLOAD_LABEL = 'Upload';

export const REPLACE_LABEL = 'Replace';

export const REMOVE_LABEL = 'Remove from theme';

export const DELETE_LABEL = 'Delete image';

export const UPLOADING = 'Uploading…';

export const NO_IMAGE = 'No image: the layer below supplies it.';

export function imageNote(assetId: string): string {
  return `An image is set (${assetId.slice(0, 8)}).`;
}

export const PUBLISH_LABEL = 'Publish the draft';

export const PUBLISHING = 'Publishing…';

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

export const ISSUES_LABEL = 'What the server refused';

export function pickLabel(label: string): string {
  return `Pick ${label.toLowerCase()}`;
}
