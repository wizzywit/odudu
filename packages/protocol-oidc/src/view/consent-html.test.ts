import { describe, expect, it } from 'vitest';
import { renderConsentPage } from '#/view/consent-html';

const BASE = {
  realm: 'acme',
  authSessionId: 'session-id',
  clientName: 'Acme Dashboard',
  defaultScopes: ['openid', 'profile'],
  optionalScopes: ['offline_access', 'email'],
  alreadyGranted: ['email'],
};

describe('renderConsentPage', () => {
  it('escapes a hostile client name and never emits the raw form', () => {
    const page = renderConsentPage({ ...BASE, clientName: '<script>alert(1)</script>' });
    // A test that only asserts the escaped form is present would also pass
    // against a page that emits both the escaped and the raw string — the
    // negative assertion is what proves the raw markup never reaches the
    // document.
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.html).not.toContain('<script>alert(1)</script>');
  });

  it('lists every default scope without a checkbox', () => {
    const page = renderConsentPage(BASE);
    for (const scope of BASE.defaultScopes) {
      expect(page.body).toContain(scope);
    }
    // Would still pass if a default scope also got a checkbox rendered
    // beside it under a different attribute name, so pin the absence of
    // any input named after a default scope.
    expect(page.body).not.toMatch(/<input[^>]*value="openid"/);
    expect(page.body).not.toMatch(/<input[^>]*value="profile"/);
  });

  it('gives every optional scope a checkbox, pre-ticked when already granted', () => {
    const page = renderConsentPage(BASE);
    // offline_access was not granted: present as a checkbox, not checked.
    expect(page.body).toMatch(/<input type="checkbox" name="scope" value="offline_access">/);
    // email was granted: same checkbox, but checked — a test asserting only
    // the unchecked pattern would pass even if every scope came pre-ticked.
    expect(page.body).toMatch(/<input type="checkbox" name="scope" value="email" checked>/);
    expect(page.body).not.toMatch(
      /<input type="checkbox" name="scope" value="offline_access" checked>/,
    );
  });

  it('gives Allow and Deny distinguishable submitted values', () => {
    const page = renderConsentPage(BASE);
    expect(page.body).toMatch(/<button type="submit" name="decision" value="allow">/);
    expect(page.body).toMatch(/<button type="submit" name="decision" value="deny">/);
    // Same name, different value: a form that instead rendered two buttons
    // both named "decision" with the same value would satisfy a looser
    // check, so pin both values distinctly.
  });

  it('carries auth_session_id as a hidden field', () => {
    const page = renderConsentPage(BASE);
    expect(page.body).toContain('<input type="hidden" name="auth_session_id" value="session-id">');
  });

  it('renders no script, matching a null CSP script directive', () => {
    const page = renderConsentPage(BASE);
    expect(page.script).toBeNull();
    expect(page.body).not.toContain('<script');
  });

  it('returns a body fragment and a title beside the document', () => {
    const page = renderConsentPage(BASE);
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });
});
