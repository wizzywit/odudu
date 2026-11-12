import { DEFAULT_PAGE_LOCALE, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { renderAcceptTermsPage } from '#/view/accept-terms-html';
import { en } from '#/view/messages';
import { ar } from '#/view/messages.ar';

const ADDRESS = pathAddress('https://idp.example', 'acme');
const OFFER = { uri: 'https://example.com/terms?lang=en', version: '2026-01' };

function page(offer = OFFER, refused = false): string {
  return renderAcceptTermsPage('acme', ADDRESS, 'sess-1', offer, refused, DEFAULT_PAGE_LOCALE).html;
}

describe('the accept-terms page', () => {
  it('posts to the required-action step for this action, bound to the sign-in', () => {
    const html = page();
    expect(html).toContain(
      'action="/tenants/acme/login-actions/required-action?action=accept-terms"',
    );
    expect(html).toContain('<input type="hidden" name="auth_session_id" value="sess-1">');
  });

  it('links the terms safely and names the version', () => {
    const html = page();
    expect(html).toContain(
      '<a href="https://example.com/terms?lang=en" rel="noopener noreferrer" target="_blank">',
    );
    expect(html).toContain('2026-01');
  });

  it('has one checkbox that says I accept, and no cancel', () => {
    const html = page();
    expect(html.match(/type="checkbox"/gu)).toHaveLength(1);
    expect(html).toContain('name="accept"');
    expect(html).toContain(en['acceptTerms.accept']);
    expect(html).not.toContain('name="cancel"');
  });

  it('escapes a hostile address and version', () => {
    const html = page({ uri: 'https://example.com/"><script>x</script>', version: '<b>1</b>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<b>1</b>');
  });

  it('says so in the error slot when the box was not ticked', () => {
    const html = page(OFFER, true);
    expect(html).toContain('role="alert"');
    expect(html).toContain(en['acceptTerms.required']);
  });

  it('has an Arabic twin for every sentence it uses', () => {
    for (const key of Object.keys(en).filter((each) => each.startsWith('acceptTerms.'))) {
      expect(Object.hasOwn(ar, key), key).toBe(true);
    }
  });
});
