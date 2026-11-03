import { describe, expect, it, vi } from 'vitest';
import { contrastReport } from '#/features/branding-editor/services/contrast';
import {
  announcePublish,
  NO_OUTCOME,
  publishOutcomeOf,
  publishDefected,
  currentOutcome,
} from '#/features/branding-editor/services/publishOutcome';
import { DEFAULT_PALETTES } from '#/features/branding-editor/services/palette';

describe('a publish answer', () => {
  it('toasts only when it asks to', () => {
    const toast = vi.fn();
    announcePublish(NO_OUTCOME, toast);
    expect(toast).not.toHaveBeenCalled();
    announcePublish({ ...NO_OUTCOME, toast: 'Published.' }, toast);
    expect(toast).toHaveBeenCalledExactlyOnceWith('Published.');
  });
});

describe('a publish', () => {
  it('tells a send that threw as a defect, held at its draft', () => {
    const told = publishDefected((failure) => failure.kind, '"d1"');
    expect(told.message).toBe('defect');
    expect(told.atTag).toBe('"d1"');
    expect(told.toast).toBeNull();
  });

  it('toasts only when it went through', () => {
    const ok = publishOutcomeOf(
      {
        ok: true,
        status: 200,
        data: { ...({} as object), warnings: [] } as never,
        etag: null,
        next: null,
      },
      () => '',
      '"d1"',
    );
    expect(ok.toast).toBe('Theme published');
    expect(publishOutcomeOf({ ok: false, kind: 'network' }, () => 'lost', '"d1"').toast).toBeNull();
    expect(NO_OUTCOME.toast).toBeNull();
  });

  it('keeps a refusal’s errors with the draft it was given for', () => {
    const errors = [{ path: 'stylesheet', message: 'm', line: 3 }];
    const refused = publishOutcomeOf(
      {
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Bad', status: 400, errors },
      },
      () => 'no',
      '"d1"',
    );
    expect(refused).toMatchObject({ errors, atTag: '"d1"', message: 'no' });
    expect(NO_OUTCOME).toMatchObject({ errors: [], atTag: null });
  });

  it('shows a refusal only for the draft it was given for', () => {
    const refused = publishOutcomeOf(
      { ok: false, kind: 'problem', problem: { type: 'about:blank', title: 'Bad', status: 400 } },
      () => 'no',
      '"d1"',
    );
    expect(currentOutcome(refused, '"d1"')).toBe(refused);
    expect(currentOutcome(refused, '"d2"')).toBe(NO_OUTCOME);
    const lost = publishOutcomeOf({ ok: false, kind: 'network' }, () => 'lost', '"d1"');
    expect(currentOutcome(lost, '"d2"')).toBe(NO_OUTCOME);
    const ok = publishOutcomeOf(
      { ok: true, status: 200, data: { warnings: [] } as never, etag: null, next: null },
      () => '',
      '"d1"',
    );
    expect(currentOutcome(ok, '"d2"')).toBe(ok);
  });

  it('tells a screen reader only whether the contrast passes', () => {
    const values = {
      'tokens.light': DEFAULT_PALETTES.light,
      'tokens.dark': null,
      'tokens.font': null,
    };
    expect(contrastReport(values).verdict).toBe('Contrast passes.');
    const worse = {
      ...values,
      'tokens.light': { ...DEFAULT_PALETTES.light, inkPrimary: '#e8e8e8' },
    };
    expect(contrastReport(worse).verdict).toMatch(/^Contrast fails/u);
  });
});
