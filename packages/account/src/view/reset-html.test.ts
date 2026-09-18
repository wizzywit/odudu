import { describe, expect, it } from 'vitest';
import {
  renderResetLinkFailedPage,
  renderResetPasswordForm,
  renderResetPasswordRequiredPage,
  renderResetPasswordSucceededPage,
  renderResetPasswordWeakPage,
  renderResetRequestedPage,
  renderResetRequestFailedPage,
  renderResetRequestForm,
} from '#/view/reset-html';

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderResetRequestForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetRequestForm('acme');
    expect(page.title).toBe('Forgot your password?');
    expect(page.body).toContain('name="email"');
    expectFragment(page);
  });
});

describe('renderResetRequestedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetRequestedPage();
    expect(page.title).toBe('Check your email');
    expect(page.body).toContain("we've sent a link");
    expectFragment(page);
  });
});

describe('renderResetRequestFailedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetRequestFailedPage('Email is required.');
    expect(page.title).toBe("Can't send a reset link");
    expect(page.body).toContain('Email is required.');
    expectFragment(page);
  });
});

describe('renderResetPasswordForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetPasswordForm('acme', 'token-key');
    expect(page.title).toBe('Choose a new password');
    expect(page.body).toContain('value="token-key"');
    expectFragment(page);
  });
});

describe('renderResetPasswordSucceededPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetPasswordSucceededPage();
    expect(page.title).toBe('Password reset');
    expect(page.body).toContain('Your password has been reset');
    expectFragment(page);
  });
});

describe('renderResetLinkFailedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetLinkFailedPage();
    expect(page.title).toBe("Can't use this link");
    expect(page.body).toContain("This link can't be used");
    expectFragment(page);
  });
});

describe('renderResetPasswordWeakPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetPasswordWeakPage(['Password must be at least 8 characters long.']);
    expect(page.title).toBe("Can't reset your password");
    expect(page.body).toContain('Password must be at least 8 characters long.');
    expectFragment(page);
  });
});

describe('renderResetPasswordRequiredPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderResetPasswordRequiredPage();
    expect(page.title).toBe("Can't reset your password");
    expect(page.body).toContain('A new password is required.');
    expectFragment(page);
  });
});
