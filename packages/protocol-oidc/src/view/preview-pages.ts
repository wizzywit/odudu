import { type PageKind, type PreviewRender } from '@odudu/kernel';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import { renderLoggedOutPage, renderLogoutConfirmationPage } from '#/view/logout-html';
import { renderSelectAccountPage } from '#/view/select-account-html';

type OidcKind = Extract<
  PageKind,
  | 'sign-in'
  | 'consent'
  | 'select-account'
  | 'logout-confirm'
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
      tenant,
      SESSION,
      'preview-csrf',
      { clientId: null, postLogoutRedirectUri: null, state: null },
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
