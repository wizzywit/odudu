import { describe, expect, it } from 'vitest';
import { renderTotpEnrolmentPage } from '#/view/totp-enrolment-html';

const OFFER = {
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  uri: 'otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=acme&algorithm=SHA1&digits=6&period=30',
};

describe('renderTotpEnrolmentPage', () => {
  it('draws the URI as a QR code as well as text', () => {
    const page = renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(page).toContain('<svg');
    expect(page).toContain('</svg>');
    expect(page).toContain(`value="${OFFER.secret}"`);
  });

  // The URI carries `&` between its parameters, which is an entity
  // reference in HTML: printed raw it is not the string an app would read
  // back, and the same escaping is what keeps an interpolated value from
  // closing the tag it sits in.
  it('escapes the URI where it appears as text', () => {
    const page = renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(page).toContain(
      '<code>otpauth://totp/acme:ada?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&amp;issuer=acme&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code>',
    );
    expect(page).not.toContain('period=30</code>&');
  });

  it('escapes the realm, the session id and an error message', () => {
    const page = renderTotpEnrolmentPage(
      'acme"><script>',
      'session"><script>',
      OFFER,
      'wrong <code>',
    );

    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;');
    expect(page).toContain('wrong &lt;code&gt;');
  });

  it('says nothing about an error when there is none', () => {
    expect(renderTotpEnrolmentPage('acme', 'auth-session-1', OFFER)).not.toContain('<strong>');
  });
});
