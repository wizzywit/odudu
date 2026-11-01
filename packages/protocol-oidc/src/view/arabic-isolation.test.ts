import { describe, expect, it } from 'vitest';
import { renderConsentPage } from '#/view/consent-html';
import { renderLoginForm } from '#/view/authorize-html';
import { ar } from '#/view/messages.ar';
import { renderServerErrorPage } from '#/view/server-error-html';
import { ARABIC } from '@odudu/testkit/i18n';

// A name somebody else chose is Latin, carries markup and punctuation, and is
// set inside right-to-left text: it is escaped once and sits in its own <bdi>.
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);
const HOSTILE = '<i>Acme</i> & Co "Ltd" (EU)';
const ISOLATED = '<bdi>&lt;i&gt;Acme&lt;/i&gt; &amp; Co &quot;Ltd&quot; (EU)</bdi>';

describe('a page in Arabic isolates what somebody else wrote', () => {
  it('the client in the sign-in context', () => {
    const page = renderLoginForm(
      'acme',
      'session-id',
      'password',
      undefined,
      undefined,
      undefined,
      undefined,
      HOSTILE,
      {},
      ARABIC,
    );
    expect(page.body).toContain(`للمتابعة إلى ${ISOLATED}`);
  });

  it('the client in the consent heading and its about link', () => {
    const page = renderConsentPage(
      {
        tenant: 'acme',
        authSessionId: 'session-id',
        clientName: HOSTILE,
        clientPages: { clientUri: 'https://acme.example/about', policyUri: null, tosUri: null },
        defaultScopes: ['openid'],
        optionalScopes: [],
        alreadyGranted: [],
        scopeLabels: {},
      },
      ARABIC,
    );
    expect(page.body).toContain(`يطلب ${ISOLATED} الوصول`);
    expect(page.body).toContain(`نبذة عن ${ISOLATED}`);
  });

  it('a scope label beside the ongoing-access note', () => {
    const page = renderConsentPage(
      {
        tenant: 'acme',
        authSessionId: 'session-id',
        clientName: 'Acme',
        clientPages: { clientUri: null, policyUri: null, tosUri: null },
        defaultScopes: [],
        optionalScopes: ['offline_access'],
        alreadyGranted: [],
        scopeLabels: { offline_access: HOSTILE },
      },
      ARABIC,
    );
    expect(page.body).toContain(`${ISOLATED} — يمنح وصولًا مستمرًا`);
  });

  it('the request id on the server-error page', () => {
    const page = renderServerErrorPage('01JABC<x>', ARABIC);
    expect(page.body).toContain('معرّف الطلب: <bdi>01JABC&lt;x&gt;</bdi>');
  });

  it('the passkey failure reason, which the page script fills in', () => {
    expect(ar['login.passkey.failed']).toContain(`${FSI}{reason}${PDI}`);
  });
});
