import { type PageKind, type PreviewRender, pathAddress } from '@odudu/kernel';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { renderApprovalPage } from '#/view/approval-html';
import { renderConsentPage } from '#/view/consent-html';
import { renderLoggedOutPage, renderLogoutConfirmationPage } from '#/view/logout-html';
import { renderSelectAccountPage } from '#/view/select-account-html';

type OidcKind = Extract<
  PageKind,
  | 'sign-in'
  | 'consent'
  | 'select-account'
  | 'logout-confirm'
  | 'approval'
  | 'authorize-error'
  | 'email-unverified'
  | 'logged-out'
>;

const SESSION = 'preview-session';

// Each kind of this package rendered by its own renderer with fixed sample
// values, for the theme preview. No value here is real or secret.
export const PREVIEW_PAGES: Readonly<Record<OidcKind, PreviewRender>> = {
  'sign-in': (tenant, locale) =>
    renderLoginForm(
      tenant,
      pathAddress('', tenant),
      SESSION,
      'password',
      true,
      true,
      undefined,
      false,
      'Example app',
      { createAccount: '#', resetPassword: '#' },
      locale,
    ),
  consent: (tenant, locale) =>
    renderConsentPage(
      {
        tenant,
        address: pathAddress('', tenant),
        authSessionId: SESSION,
        clientName: 'Example app',
        clientPages: {
          clientUri: 'https://example.com',
          policyUri: 'https://example.com/privacy',
          tosUri: 'https://example.com/terms',
        },
        defaultScopes: ['openid', 'profile'],
        optionalScopes: ['email', 'offline_access'],
        alreadyGranted: ['email'],
        scopeLabels: {},
      },
      locale,
    ),
  'select-account': (tenant, locale) =>
    renderSelectAccountPage(
      {
        tenant,
        address: pathAddress('', tenant),
        authSessionId: SESSION,
        accounts: [
          { sessionId: 'preview-account-1', displayName: 'Ada Example' },
          { sessionId: 'preview-account-2', displayName: 'Grace Example' },
        ],
      },
      locale,
    ),
  'logout-confirm': (tenant, locale) =>
    renderLogoutConfirmationPage(
      pathAddress('', tenant),
      SESSION,
      'preview-csrf',
      { clientId: null, postLogoutRedirectUri: null, state: null },
      locale,
    ),
  approval: (tenant, locale) =>
    renderApprovalPage(
      {
        address: pathAddress('', tenant),
        approvalId: '00000000-0000-4000-8000-000000000000',
        csrf: 'preview-csrf',
        tenant,
        agent: 'Example agent',
        summary: 'Example agent asks to sign in as you with: openid',
        scope: 'openid',
        bindingMessage: 'Approve the example request',
        expiresAt: new Date('2026-01-01T00:10:00Z'),
      },
      locale,
    ),
  'authorize-error': (_tenant, locale) =>
    renderAuthorizeErrorPage(
      'invalid_request',
      'The request could not be completed.',
      { kind: 'restart', href: '#' },
      locale,
    ),
  'email-unverified': (_tenant, locale) => renderEmailUnverifiedPage(true, '#', locale),
  'logged-out': (_tenant, locale) => renderLoggedOutPage([], locale),
};
