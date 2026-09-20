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

  it('frames each URL it is given, as its own iframe and its own origin', () => {
    const page = renderLoggedOutPage([
      'https://rp-one.example/logout?iss=a',
      'https://rp-two.example/logout?iss=a',
    ]);
    expect(page.body).toContain('<iframe src="https://rp-one.example/logout?iss=a"></iframe>');
    expect(page.body).toContain('<iframe src="https://rp-two.example/logout?iss=a"></iframe>');
    expect(page.frames).toEqual(['https://rp-one.example', 'https://rp-two.example']);
  });

  it('escapes a query character in a framed URL rather than passing it through raw', () => {
    const page = renderLoggedOutPage(['https://rp.example/logout?a=1&b=2']);
    expect(page.body).toContain('<iframe src="https://rp.example/logout?a=1&amp;b=2"></iframe>');
    expect(page.body).not.toContain('logout?a=1&b=2"');
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
