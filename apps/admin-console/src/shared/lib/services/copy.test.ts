import { describe, expect, it } from 'vitest';
import {
  copiedDescription,
  copyBlocked,
  copyBusy,
  copyingLineOf,
  copyReadOf,
} from '#/shared/lib/services/copy';

it('shows the description edited, else the source one', () => {
  expect(copiedDescription('mine', 'Reads')).toBe('mine');
  expect(copiedDescription('', 'Reads')).toBe('');
  expect(copiedDescription(null, 'Reads')).toBe('Reads');
  expect(copiedDescription(null, null)).toBe('');
});

describe('what holds a copy back', () => {
  const partial = { text: 't', href: '/h', name: 'n' };

  it('is busy while a write is under way, the source is read, or the caller is not known', () => {
    expect(copyBusy(false, 'ready', ['view-users'])).toBe(false);
    expect(copyBusy(true, 'ready', [])).toBe(true);
    expect(copyBusy(false, 'loading', [])).toBe(true);
    expect(copyBusy(false, 'none', undefined)).toBe(true);
    expect(copyBusy(false, 'failed', [])).toBe(false);
  });
  it('is blocked for the same, and for a copy part-made that stays on the page', () => {
    expect(copyBlocked(false, null, 'ready', [])).toBe(false);
    expect(copyBlocked(false, partial, 'ready', [])).toBe(true);
    expect(copyBlocked(true, null, 'ready', [])).toBe(true);
    expect(copyBlocked(false, null, 'loading', [])).toBe(true);
    expect(copyBlocked(false, null, 'none', undefined)).toBe(true);
  });
});

describe('what a copy is read as', () => {
  const source = { name: 'billing' };

  it('is none without something to copy, loading until read, and failed on an error or no source', () => {
    expect(copyReadOf(null, undefined, false)).toEqual({ status: 'none' });
    expect(copyReadOf('s1', undefined, false)).toEqual({ status: 'loading' });
    expect(copyReadOf('s1', undefined, true)).toEqual({ status: 'failed' });
    expect(copyReadOf('s1', null, false)).toEqual({ status: 'failed' });
    expect(copyReadOf('s1', source, false)).toEqual({ status: 'ready', name: 'billing' });
  });
});

describe('the line a copy in progress opens with', () => {
  const say = (ready: { status: 'ready'; name: string }) => `A copy of ${ready.name}.`;

  it('is said once what is copied is known, and not before', () => {
    expect(copyingLineOf({ status: 'ready', name: 'billing' }, say)).toBe('A copy of billing.');
    expect(copyingLineOf({ status: 'loading' }, say)).toBeNull();
    expect(copyingLineOf({ status: 'failed' }, say)).toBeNull();
    expect(copyingLineOf({ status: 'none' }, say)).toBeNull();
  });
});
