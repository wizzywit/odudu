import { describe, expect, it } from 'vitest';
import {
  renderPasskeyEnrolmentPage,
  type PasskeyEnrolmentOffer,
} from '#/view/passkey-enrolment-html';

const OFFER: PasskeyEnrolmentOffer = {
  options: {
    rp: { name: 'acme', id: 'id.example.com' },
    user: { id: 'c3ViamVjdA', name: 'ada', displayName: 'ada' },
    challenge: 'Q0hBTExFTkdF',
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: [{ id: 'ZXhpc3Rpbmc', type: 'public-key' }],
  },
};

describe('renderPasskeyEnrolmentPage', () => {
  it('carries the creation options and the field the ceremony fills in', () => {
    const { html: page } = renderPasskeyEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(page).toContain('"challenge":"Q0hBTExFTkdF"');
    expect(page).toContain('name="credential"');
    expect(page).toContain('value="auth-session-1"');
    expect(page).toContain(
      'action="/realms/acme/login-actions/required-action?action=configure-passkey"',
    );
  });

  // Only the browser can produce a registration response, so a page that
  // did not emit the call is a page nobody can enrol from.
  it('emits the ceremony itself, and a path for a refusal', () => {
    const { html: page } = renderPasskeyEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(page).toContain('navigator.credentials.create');
    expect(page).toContain('excludeCredentials');
    expect(page).toContain('catch (caught)');
    expect(page).toContain('<noscript>');
  });

  // A refused script is invisible in a response, so the only checkable half
  // is that the page and the policy sent with it name the same nonce. The
  // page returns the nonce it used rather than being handed one, which is
  // what makes them impossible to diverge.
  it('carries the nonce it reports, freshly per render', () => {
    const first = renderPasskeyEnrolmentPage('acme', 'auth-session-1', OFFER);
    const second = renderPasskeyEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(first.script?.nonce).toBeDefined();
    expect(first.html).toContain(`<script nonce="${String(first.script?.nonce)}">`);
    expect(first.script?.nonce).not.toBe(second.script?.nonce);
  });

  // The options are inline on this page, so its script asks for nothing —
  // and a directive licensing a request nobody makes has stopped describing
  // the page.
  it('reports that its script fetches nothing', () => {
    expect(renderPasskeyEnrolmentPage('acme', 'auth-session-1', OFFER).script).toMatchObject({
      fetchesSameOrigin: false,
    });
  });

  it('bounds what can be typed into the label', () => {
    const { html: page } = renderPasskeyEnrolmentPage('acme', 'auth-session-1', OFFER);

    expect(page).toContain('name="label"');
    expect(page).toContain('maxlength="64"');
  });

  it('escapes the realm, the session id and an error message', () => {
    const { html: page } = renderPasskeyEnrolmentPage(
      'acme"><script>',
      'session"><script>',
      OFFER,
      'refused <code>',
    );

    expect(page).not.toContain('"><script>');
    expect(page).toContain('&lt;script&gt;');
    expect(page).toContain('refused &lt;code&gt;');
  });

  // HTML escaping does not apply inside a <script>, where the parser reads
  // text: a realm name carrying `</script>` would otherwise end the element
  // early and leave the rest of the options as markup.
  it('neutralises a value that would close the script element', () => {
    const { html: page } = renderPasskeyEnrolmentPage('acme', 'auth-session-1', {
      options: { ...OFFER.options, rp: { name: '</script><script>alert(1)</script>', id: 'x' } },
    });

    expect(page).not.toContain('</script><script>alert(1)');
    expect(page).toContain('\\u003c/script');
  });

  it('escapes the JSON line terminators JavaScript does not allow raw', () => {
    const { html: page } = renderPasskeyEnrolmentPage('acme', 'auth-session-1', {
      options: {
        ...OFFER.options,
        rp: { name: `line${String.fromCharCode(0x2028)}break`, id: 'x' },
      },
    });

    expect(page).not.toContain(String.fromCharCode(0x2028));
    expect(page).toContain('line\\u2028break');
  });
});
