import { describe, expect, it } from 'vitest';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';

describe('renderAuthorizeErrorPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderAuthorizeErrorPage('invalid_request', 'missing redirect_uri');
    expect(page.title).toBe('Request refused');
    expect(page.body).toContain('invalid_request');
    // The fragment is a fragment: a theme that wraps it must not find a
    // second document inside it.
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    // The assembled document still carries everything it carries today.
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });
});

describe('renderEmailUnverifiedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderEmailUnverifiedPage(true);
    expect(page.title).toBe('Verify your email');
    expect(page.body).toContain('verify your email');
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });
});

describe('renderLoginForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderLoginForm('acme', 'session-id', 'password');
    expect(page.title).toBe('Sign in');
    expect(page.body).toContain('name="username"');
    expect(page.body).not.toContain('<!doctype');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<!doctype html>');
    expect(page.html).toContain(page.body);
  });
});
