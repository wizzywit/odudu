import { describe, expect, it } from 'vitest';
import {
  renderRegistrationFailedPage,
  renderRegistrationForm,
  renderRegistrationSucceededPage,
} from '#/view/registration-html';

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderRegistrationForm', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderRegistrationForm('acme');
    expect(page.title).toBe('Create account');
    expect(page.body).toContain('name="username"');
    expectFragment(page);
  });
});

describe('renderRegistrationFailedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderRegistrationFailedPage(['That username is already taken.']);
    expect(page.title).toBe("Can't create this account");
    expect(page.body).toContain('That username is already taken.');
    expectFragment(page);
  });
});

describe('renderRegistrationSucceededPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderRegistrationSucceededPage(false);
    expect(page.title).toBe('Account created');
    expect(page.body).toContain('You can now sign in.');
    expectFragment(page);
  });
});
