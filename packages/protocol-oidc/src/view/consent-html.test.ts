import { describe, expect, it } from 'vitest';
import { renderConsentPage } from '#/view/consent-html';

const BASE = {
  tenant: 'acme',
  authSessionId: 'session-id',
  clientName: 'Acme Dashboard',
  clientPages: { clientUri: null, policyUri: null, tosUri: null },
  defaultScopes: ['openid', 'profile'],
  optionalScopes: ['offline_access', 'email'],
  alreadyGranted: ['email'],
  scopeLabels: {},
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

  it('links each page the client registered, escaped, and no other', () => {
    const page = renderConsentPage({
      ...BASE,
      clientPages: {
        clientUri: 'https://acme.example/?a=1&b="x"',
        policyUri: null,
        tosUri: 'https://acme.example/terms',
      },
    });
    expect(page.body).toContain('<a href="https://acme.example/?a=1&amp;b=&quot;x&quot;">');
    expect(page.body).toContain('<a href="https://acme.example/terms">Terms of service</a>');
    expect(page.body).not.toContain('Privacy policy');
    expect(page.script).toBeNull();
  });

  it('renders no link at all for a client that registered no page', () => {
    expect(renderConsentPage(BASE).body).not.toContain('<a ');
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

  // OIDC Core §16.18: "the authorization server clearly identifies
  // long-term grants to the user during authorization" — merely listing
  // offline_access alongside every other optional scope would not satisfy
  // this, so pin the distinguishing text rather than just the checkbox.
  it('[OIDC-CORE-16.18-01] identifies offline_access as a long-term grant, not just another optional scope', () => {
    const page = renderConsentPage(BASE);
    expect(page.body).toMatch(/offline_access[^<]*ongoing access/);
    // A scope with no such note (email) proves the distinction is drawn
    // deliberately, not emitted for every optional scope alike.
    expect(page.body).not.toMatch(/email[^<]*ongoing access/);
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

  it('shows a scope by its consent text, escaped, and posts its name', () => {
    const page = renderConsentPage({
      ...BASE,
      scopeLabels: { profile: 'Your <name> & "picture"', email: 'Your address' },
    });
    expect(page.body).toContain('<li>Your &lt;name&gt; &amp; &quot;picture&quot;</li>');
    expect(page.body).toContain('value="email" checked> Your address</label>');
    expect(page.body).toContain('<li>openid</li>');
    expect(page.body).not.toContain('<name>');
    expect(page.script).toBeNull();
  });
});
