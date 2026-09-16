import { describe, expect, it } from 'vitest';
import { renderRecoveryCodesPage } from '#/view/recovery-codes-html';

const OFFER = { codes: ['ABCDE-FGHJK', 'MNPQR-STVWX'], replaced: false };

describe('renderRecoveryCodesPage', () => {
  it('prints every code and says it is the only time they are shown', () => {
    const page = renderRecoveryCodesPage('acme', 'auth-session-1', OFFER);

    for (const code of OFFER.codes) {
      expect(page.html).toContain(`<code>${code}</code>`);
    }
    expect(page.html).toContain('only time they are shown');
  });

  // The form carries no code back — only the acknowledgement. A code in a
  // hidden field would be a second copy of the plaintext, in a page the
  // browser can resubmit.
  it('carries the session id back and nothing else', () => {
    const page = renderRecoveryCodesPage('acme', 'auth-session-1', OFFER);

    expect(page.html).toContain('name="auth_session_id" value="auth-session-1"');
    expect(page.html).toContain(
      'action="/realms/acme/login-actions/required-action?action=generate-recovery-codes"',
    );
    expect(page.html).not.toContain('type="hidden" name="code');
  });

  it('needs no script, so the page asks for no policy beyond the base one', () => {
    expect(renderRecoveryCodesPage('acme', 'auth-session-1', OFFER).script).toBeNull();
    expect(renderRecoveryCodesPage('acme', 'auth-session-1', OFFER).html).not.toContain('<script');
  });

  it('says so when this set retires an earlier one, and stays quiet when it does not', () => {
    const first = renderRecoveryCodesPage('acme', 'auth-session-1', OFFER);
    const again = renderRecoveryCodesPage('acme', 'auth-session-1', { ...OFFER, replaced: true });

    expect(first.html).not.toContain('no longer work');
    expect(again.html).toContain('no longer work');
  });

  it('escapes the realm, the session id, a code and an error message', () => {
    const page = renderRecoveryCodesPage(
      'acme"><script>',
      'session"><script>',
      { codes: ['<script>'], replaced: false },
      'wrong <code>',
    );

    expect(page.html).not.toContain('<script>');
    expect(page.html).toContain('&lt;script&gt;');
    expect(page.html).toContain('wrong &lt;code&gt;');
  });

  it('says nothing about an error when there is none', () => {
    expect(renderRecoveryCodesPage('acme', 'auth-session-1', OFFER).html).not.toContain(
      '<strong>wrong',
    );
  });
});
