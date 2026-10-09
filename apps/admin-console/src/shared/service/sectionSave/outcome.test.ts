import { describe, expect, it } from 'vitest';
import type { GatewayFailure } from '#/shared/service/result.ts';
import {
  afterSave,
  rereadPhase,
  saveFailureText,
  saveOutcome,
} from '#/shared/service/sectionSave/outcome.ts';
import { type SectionState } from '#/shared/service/sectionSave/state.ts';

const BASE = { name: 'a', tags: ['x'] };

type V = typeof BASE;

function state(extra: Partial<SectionState<V>> = {}): SectionState<V> {
  return {
    base: BASE,
    etag: 'e1',
    edits: {},
    conflicts: [],
    source: 'kept',
    phase: 'idle',
    fieldErrors: {},
    message: null,
    ...extra,
  };
}

function problem(
  status: number,
  extra: { detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure {
  return {
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
  };
}

describe('what a save leaves', () => {
  it('settles on the phase of the outcome, and clears what was saved', () => {
    const saved = afterSave(
      state({ edits: { name: 'b', tags: ['y'] }, fieldErrors: { name: 'old' } }),
      { phase: 'saved', fieldErrors: {}, refetch: false, refused: false },
      { name: 'b', tags: ['x'] },
    );
    expect(saved).toMatchObject({ phase: 'saved', edits: { tags: ['y'] }, fieldErrors: {} });
    const refused = afterSave(
      state({ edits: { name: 'b' } }),
      { phase: 'refused', message: 'no', refetch: false, refused: true },
      { name: 'b' },
    );
    expect(refused).toMatchObject({ phase: 'refused', message: 'no', edits: { name: 'b' } });
  });
});

describe('saveOutcome', () => {
  const ctx = { label: 'Settings', capability: 'manage-tenant', fields: ['name'] };
  const ok = { ok: true as const, status: 200, data: null, etag: 'e', next: null };

  it('toasts a save', () => {
    expect(saveOutcome(ok, ctx)).toEqual({
      phase: 'saved',
      fieldErrors: {},
      toast: { tone: 'success', message: 'Settings saved' },
      refetch: false,
      refused: false,
    });
  });
  it('re-reads after a 412, and does nothing visible for a 401', () => {
    expect(saveOutcome(problem(412), ctx)).toMatchObject({ phase: 'stale', refetch: true });
    expect(saveOutcome(problem(401), ctx)).toMatchObject({ phase: 'idle', refetch: false });
    expect(rereadPhase(true)).toBe('unread');
    expect(rereadPhase(false)).toBe('stale');
  });
  it('places a 400 under its fields and toasts what has no field', () => {
    const rejected = problem(400, {
      errors: [
        { path: 'name', message: 'long' },
        { path: 'zzz', message: 'odd' },
      ],
    });
    expect(saveOutcome(rejected, ctx)).toMatchObject({
      phase: 'invalid',
      fieldErrors: { name: 'long' },
      toast: { tone: 'error', message: 'Settings was not saved: zzz: odd' },
    });
    const bare = saveOutcome(problem(400, { errors: [{ path: 'name', message: 'long' }] }), ctx);
    expect(bare.toast).toBeUndefined();
  });
  it('words a 409 and a 403, the explanation first', () => {
    expect(saveOutcome(problem(409, { detail: 'guard' }), ctx)).toMatchObject({
      phase: 'refused',
      message: 'guard',
    });
    expect(saveOutcome(problem(409), { ...ctx, explain: () => 'explained' }).message).toBe(
      'explained',
    );
    expect(saveOutcome(problem(403), ctx)).toMatchObject({
      phase: 'refused',
      message: 'Settings was not saved: it needs the manage-tenant capability.',
      refused: true,
    });
    expect(saveOutcome(problem(403), { ...ctx, explain: () => 'explained' }).message).toBe(
      'explained',
    );
  });
  it('fails with a toast for anything else', () => {
    expect(saveOutcome({ ok: false, kind: 'defect' }, ctx)).toMatchObject({
      phase: 'failed',
      toast: { tone: 'error', message: saveFailureText('Settings', { ok: false, kind: 'defect' }) },
    });
  });
});

describe('saveFailureText', () => {
  it('says what is known and what to do', () => {
    expect(saveFailureText('Settings', { ok: false, kind: 'network' })).toBe(
      'Could not confirm that Settings was saved. Your changes are still here, and saving again is safe.',
    );
    expect(saveFailureText('Settings', { ok: false, kind: 'schema' })).toBe(
      'Settings may have been saved, but its answer could not be read. Reload to check.',
    );
    expect(saveFailureText('Settings', { ok: false, kind: 'defect' })).toBe(
      'The console could not save Settings. This is a fault in the console, not something you did.',
    );
    expect(saveFailureText('Settings', problem(404))).toBe(
      'Settings was not saved: it no longer exists.',
    );
    expect(saveFailureText('Settings', problem(500, { detail: 'boom' }))).toBe(
      'Settings was not saved: boom',
    );
  });
});
