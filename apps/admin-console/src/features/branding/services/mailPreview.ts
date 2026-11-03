export const MAIL_PREVIEW_TITLE = 'Preview';

export const MAIL_AS_LABEL = 'Preview as client';

export const MAIL_TENANT_OWN = 'Show the tenant’s own';

// What the preview shows: the tenant's look, or a client's over it.
export function mailPreviewNote(clientName: string | null): string {
  const whose =
    clientName === null
      ? 'the published theme'
      : `the published theme of ${clientName} over the tenant’s`;
  return `The verification mail, drawn by the code that sends it, from ${whose} and the tenant’s message overrides. Changes to the draft appear once you publish.`;
}

export const MAIL_FRAME_TITLE = 'Preview of the verification mail';

export const MAIL_SCHEME_LABEL = 'Colour scheme';

export const MAIL_FAILED = 'The colours and logo could not be loaded.';

export const MAIL_LOADING_BRANDING = 'Loading what the mail inherits';
