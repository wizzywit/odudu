import { describe, expect, it } from 'vitest';
import { mailQuery, MAIL_PAGE_SIZE, MAIL_STATUS_OPTIONS } from '#/pages/email/services/mailQuery';

describe('the request the panel makes', () => {
  it('asks for one bounded page, narrowed to a status only when one is chosen', () => {
    expect(mailQuery(null)).toEqual({ limit: String(MAIL_PAGE_SIZE) });
    expect(mailQuery('failed')).toEqual({ limit: String(MAIL_PAGE_SIZE), status: 'failed' });
    expect(MAIL_PAGE_SIZE).toBeLessThanOrEqual(50);
  });

  it('offers every status the server reports, and any', () => {
    expect(MAIL_STATUS_OPTIONS.map((option) => option.id)).toEqual([
      'any',
      'queued',
      'retrying',
      'failed',
      'sent',
    ]);
  });
});
