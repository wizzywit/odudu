import { describe, expect, it } from 'vitest';
import { renderRequiredActionPage } from '#/view/required-action-html';

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderRequiredActionPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderRequiredActionPage('configure-passkey');
    expect(page.title).toBe('One more step');
    expect(page.body).toContain('pending action');
    expectFragment(page);
  });

  it('names the action asked for', () => {
    const page = renderRequiredActionPage('generate-recovery-codes');
    expect(page.body).toContain('generate-recovery-codes');
  });
});
