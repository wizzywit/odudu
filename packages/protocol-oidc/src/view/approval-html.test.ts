import { DEFAULT_PAGE_LOCALE, pageHeaders, pathAddress } from '@odudu/kernel';
import { ARABIC } from '@odudu/testkit/i18n';
import { describe, expect, it } from 'vitest';
import {
  renderApprovalDecidedPage,
  renderApprovalPage,
  renderApprovalRefusedPage,
  renderApprovalSignInPage,
  renderApprovalUnavailablePage,
  type ApprovalPageView,
} from '#/view/approval-html';
import { ar, en } from '#/view/messages';

const ID = '7d0e5c6a-3b0c-4f0e-9d9a-4a8f3c1b2d10';
const HOSTILE = `<script>alert('x')</script> "quoted" & </script>`;

const view: ApprovalPageView = {
  address: pathAddress('https://idp.example', 'demo'),
  approvalId: ID,
  csrf: 'csrf-token-value',
  tenant: 'Demo',
  agent: 'Calendar Agent',
  summary: 'Calendar Agent asks to sign in as you with: openid',
  scope: 'openid',
  bindingMessage: 'Pay invoice 42',
  expiresAt: new Date('2026-11-24T09:15:00Z'),
};

describe('renderApprovalPage', () => {
  it('shows the agent, the request, the message and when it expires', () => {
    const page = renderApprovalPage(view, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('<bdi>Calendar Agent</bdi> is asking for your approval');
    expect(page.body).toContain(
      '<bdi>Calendar Agent</bdi> asks to sign in as you with: <bdi>openid</bdi>',
    );
    expect(page.body).toContain('Pay invoice 42');
    expect(page.body).toContain('2026-11-24 09:15 UTC');
  });

  it('posts both decisions to its own address with the token bound to this approval', () => {
    const page = renderApprovalPage(view, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain(`<form method="post" action="/tenants/demo/approval/${ID}">`);
    expect(page.body).toContain('<input type="hidden" name="csrf" value="csrf-token-value">');
    expect(page.body).toMatch(/<button type="submit" name="decision" value="approve">Approve</u);
    expect(page.body).toMatch(/<button[^>]*name="decision" value="deny"[^>]*>Deny</u);
  });

  it('escapes the summary and the binding message once, wherever they carry markup', () => {
    const page = renderApprovalPage(
      { ...view, summary: HOSTILE, bindingMessage: HOSTILE, agent: HOSTILE, tenant: HOSTILE },
      DEFAULT_PAGE_LOCALE,
    );
    expect(page.html).not.toContain('<script');
    expect(page.html).not.toContain('</script>');
    const escaped =
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &quot;quoted&quot; &amp; &lt;/script&gt;';
    expect(page.body.split(escaped).length - 1).toBeGreaterThanOrEqual(4);
    expect(page.html).not.toContain('&amp;lt;');
    expect(page.html).not.toContain('&amp;amp;');
  });

  it('says what is asked in the reader’s language, from the scopes, not the stored English', () => {
    const page = renderApprovalPage({ ...view, scope: 'openid email' }, ARABIC);
    expect(page.body).toContain('بالنطاقات');
    expect(page.body).not.toContain('asks to sign in as you');
  });

  it('escapes a hostile scope in the sentence it builds', () => {
    const page = renderApprovalPage({ ...view, scope: HOSTILE }, DEFAULT_PAGE_LOCALE);
    expect(page.html).not.toContain('<script');
  });

  it('names the tenant by the name it was given, escaped', () => {
    const page = renderApprovalPage({ ...view, tenant: 'Northwind <Ltd>' }, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain('Northwind &lt;Ltd&gt;');
  });

  it('omits the message line when the request carried none', () => {
    const page = renderApprovalPage({ ...view, bindingMessage: null }, DEFAULT_PAGE_LOCALE);
    expect(page.body).not.toContain(en['approval.bindingMessage'].split('{')[0] ?? '');
  });

  it('is served by the authority with no script, framing denied and nothing cached', () => {
    const page = renderApprovalPage(view, DEFAULT_PAGE_LOCALE);
    expect(page.script).toBeNull();
    expect(page.html).not.toMatch(/<script|\son[a-z]+=|style="/iu);
    const headers = Object.fromEntries(pageHeaders(page));
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).not.toContain('script-src');
    expect(headers['cache-control']).toContain('no-store');
  });

  it('is worded in Arabic, right to left, with the data isolated', () => {
    const page = renderApprovalPage(view, ARABIC);
    expect(page.html).toContain('<html lang="ar" dir="rtl">');
    expect(page.body).toContain('<bdi>Calendar Agent</bdi>');
    expect(page.body).toContain(ar['approval.approve']);
  });
});

describe('the pages that end it', () => {
  it('the generic page says nothing of why it is generic', () => {
    const page = renderApprovalUnavailablePage(DEFAULT_PAGE_LOCALE);
    expect(page.title).toBe(en['approval.unavailable.title']);
    expect(page.body).not.toMatch(/<form|<a |someone|owner|expired|denied|approved/iu);
    expect(page.script).toBeNull();
  });

  it.each([
    ['approved', 'approval.decided.approved'],
    ['denied', 'approval.decided.denied'],
  ] as const)('says %s and offers no further decision', (decision, key) => {
    const page = renderApprovalDecidedPage(decision, DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain(en[`${key}.title` as keyof typeof en]);
    expect(page.body).not.toContain('<form');
  });

  it('the sign-in page names no approval and carries no form', () => {
    const page = renderApprovalSignInPage(DEFAULT_PAGE_LOCALE);
    expect(page.body).toContain(en['approval.signIn.title']);
    expect(page.body).not.toMatch(/<form|<a /u);
  });

  it('the refused page carries no form', () => {
    expect(renderApprovalRefusedPage(DEFAULT_PAGE_LOCALE).body).not.toContain('<form');
  });
});

describe('the approval catalogue', () => {
  it('holds every approval key in Arabic too', () => {
    const keys = Object.keys(en).filter((key) => key.startsWith('approval.'));
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) expect(Object.hasOwn(ar, key), key).toBe(true);
  });
});
