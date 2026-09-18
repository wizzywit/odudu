import { describe, expect, it } from 'vitest';
import {
  renderLoggedOutPage,
  renderLogoutConfirmationPage,
  renderLogoutRedirectRefusedPage,
  renderLogoutUnauthenticatedPage,
  renderNoActiveSessionPage,
} from '#/view/logout-html';

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderLogoutConfirmationPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLogoutConfirmationPage('acme', 'session-id', {
      clientId: null,
      postLogoutRedirectUri: null,
      state: null,
    });
    expect(page.title).toBe('Sign out?');
    expect(page.body).toContain('name="session_id"');
    expectFragment(page);
  });
});

describe('renderNoActiveSessionPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderNoActiveSessionPage();
    expect(page.title).toBe('Already signed out');
    expect(page.body).toContain('no active session');
    expectFragment(page);
  });
});

describe('renderLoggedOutPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLoggedOutPage();
    expect(page.title).toBe('Signed out');
    expect(page.body).toContain('signed out');
    expectFragment(page);
  });
});

describe('renderLogoutRedirectRefusedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLogoutRedirectRefusedPage();
    expect(page.title).toBe('Signed out');
    expect(page.body).toContain('not one this client has registered');
    expectFragment(page);
  });
});

describe('renderLogoutUnauthenticatedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLogoutUnauthenticatedPage();
    expect(page.title).toBe("Can't sign out");
    expect(page.body).toContain('no longer valid');
    expectFragment(page);
  });
});
