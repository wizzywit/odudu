import { describe, expect, it } from 'vitest';
import { renderTotpEnrolmentPage } from '#/view/totp-enrolment-html';

const OFFER = {
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  uri: 'otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=acme&algorithm=SHA1&digits=6&period=30',
};

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderTotpEnrolmentPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER);
    expect(page.title).toBe('Set up your authenticator');
    expect(page.body).toContain('Scan this with your authenticator app');
    expectFragment(page);
  });

  it('draws the URI as a QR code as well as text', () => {
    const page = renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(page.html).toContain('<svg');
    expect(page.html).toContain('</svg>');
    expect(page.html).toContain(`value="${OFFER.secret}"`);
  });

  // The URI carries `&` between its parameters, which is an entity
  // reference in HTML: printed raw it is not the string an app would read
  // back, and the same escaping is what keeps an interpolated value from
  // closing the tag it sits in.
  it('escapes the URI where it appears as text', () => {
    const page = renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(page.html).toContain(
      '<code>otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&amp;issuer=acme&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code>',
    );
    expect(page.html).not.toContain('period=30</code>&');
  });

  it('escapes the tenant, the session id and an error message', () => {
    const page = renderTotpEnrolmentPage(
      'acme"><script>',
      'session"><script>',
      OFFER,
      'wrong <code>',
    );

    expect(page.html).not.toContain('<script>');
    expect(page.html).toContain('&lt;script&gt;');
    expect(page.html).toContain('wrong &lt;code&gt;');
  });

  it('says nothing about an error when there is none', () => {
    expect(renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER).html).not.toContain('<strong>');
  });

  it('needs no script, so the page asks for no policy beyond the base one', () => {
    expect(renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER).script).toBeNull();
  });
});
