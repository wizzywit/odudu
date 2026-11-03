import { describe, expect, it } from 'vitest';
import { mailPreviewNote } from '#/pages/branding/services/mailPreview';

describe('what the preview says about whose mail it shows', () => {
  it('says the tenant’s own until a client is named, then names the client', () => {
    expect(mailPreviewNote(null)).toMatch(/from the published theme and/u);
    expect(mailPreviewNote('Billing')).toContain(
      'the published theme of Billing over the tenant’s',
    );
  });
});
