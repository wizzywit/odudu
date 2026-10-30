import { describe, expect, it } from 'vitest';
import { previewAsked, previewRetry, previewSummary } from '#/features/branding/service/preview';

describe('previewAsked', () => {
  it('wants the account only when a preview is framed over a theme that was read', () => {
    expect(previewAsked(true, {})).toBe(true);
    expect(previewAsked(true, undefined)).toBe(false);
    expect(previewAsked(false, {})).toBe(false);
  });
});

describe('previewSummary', () => {
  it('names what the strip shows, page first, and leaves out what is not set', () => {
    expect(previewSummary('Sign in', 'Light')).toBe('Sign in · Light');
    expect(previewSummary('Email', 'Dark', '')).toBe('Email · Dark');
  });
});

describe('previewRetry', () => {
  it('is the way to ask again once the preview’s account could not be read', () => {
    const retry = () => undefined;
    expect(previewRetry({ status: 'failed', refused: false, retry })).toBe(retry);
  });

  it('is nothing while it loads or after it was read', () => {
    expect(previewRetry({ status: 'loading' })).toBeUndefined();
    expect(previewRetry({ status: 'ready', data: {} })).toBeUndefined();
  });
});
