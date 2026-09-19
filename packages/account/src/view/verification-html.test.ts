import { describe, expect, it } from 'vitest';
import {
  renderVerificationFailedPage,
  renderVerificationSucceededPage,
} from '#/view/verification-html';

function expectFragment(page: { html: string; body: string }): void {
  expect(page.body).not.toContain('<!doctype');
  expect(page.body).not.toContain('<html');
  expect(page.html).toContain('<!doctype html>');
  expect(page.html).toContain(page.body);
}

describe('renderVerificationSucceededPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderVerificationSucceededPage();
    expect(page.title).toBe('Email verified');
    expect(page.body).toContain('is verified');
    expectFragment(page);
  });
});

describe('renderVerificationFailedPage', () => {
  it('returns a body fragment and a title beside the document', () => {
    const page = renderVerificationFailedPage();
    expect(page.title).toBe("Can't verify this link");
    expect(page.body).toContain("This link can't be used");
    expectFragment(page);
  });
});
