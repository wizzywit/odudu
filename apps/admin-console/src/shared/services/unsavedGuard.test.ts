import { describe, expect, it, vi } from 'vitest';
import {
  left,
  requested,
  settledDeparture,
  stayed,
  unsavedLabels,
  withLabel,
  type Departure,
} from '#/shared/services/unsavedGuard';

function departure(): Departure {
  return { proceed: vi.fn(), refuse: vi.fn() };
}

const DIRTY = new Map([['client/general', 'General']]);

describe('withLabel', () => {
  it('marks a section dirty under the name a person knows it by', () => {
    const next = withLabel(new Map(), 'client/general', 'General');
    expect(next).toEqual(DIRTY);
  });
  it('is unchanged for the same label, and for forgetting a section never marked', () => {
    expect(withLabel(DIRTY, 'client/general', 'General')).toBeNull();
    expect(withLabel(new Map(), 'client/general', null)).toBeNull();
  });
  it('renames a section, forgets one, and leaves what it was given alone', () => {
    expect(withLabel(DIRTY, 'client/general', 'Details')).toEqual(
      new Map([['client/general', 'Details']]),
    );
    expect(withLabel(DIRTY, 'client/general', null)).toEqual(new Map());
    expect(DIRTY).toEqual(new Map([['client/general', 'General']]));
  });
});

describe('settledDeparture', () => {
  it('is the held departure once nothing is left unsaved, and nothing before', () => {
    const held = departure();
    expect(settledDeparture({ dirty: new Map(), pending: held, generation: 0 })).toBe(held);
    expect(settledDeparture({ dirty: DIRTY, pending: held, generation: 0 })).toBeNull();
    expect(settledDeparture({ dirty: new Map(), pending: null, generation: 0 })).toBeNull();
  });
});

describe('requested', () => {
  const proceed = vi.fn();
  const refuse = vi.fn();

  it('lets a departure through with nothing dirty, handing back the stale question to refuse', () => {
    const stale = departure();
    expect(requested({ dirty: new Map(), pending: stale, generation: 0 }, proceed, refuse)).toEqual(
      {
        now: true,
        stale,
      },
    );
    expect(requested({ dirty: new Map(), pending: null, generation: 0 }, proceed, refuse)).toEqual({
      now: true,
      stale: null,
    });
  });
  it('holds it while something is dirty, handing back the question it replaces', () => {
    const replaced = departure();
    expect(requested({ dirty: DIRTY, pending: replaced, generation: 0 }, proceed, refuse)).toEqual({
      now: false,
      held: { proceed, refuse },
      replaced,
    });
    expect(requested({ dirty: DIRTY, pending: null, generation: 0 }, proceed, refuse)).toEqual({
      now: false,
      held: { proceed, refuse },
      replaced: null,
    });
  });
});

describe('stayed and left', () => {
  it('stay drops the held departure and answers it as refused', () => {
    const held = departure();
    expect(stayed({ dirty: DIRTY, pending: held, generation: 3 })).toEqual({
      patch: { pending: null },
      answer: held,
    });
    expect(stayed({ dirty: DIRTY, pending: null, generation: 3 }).answer).toBeNull();
  });
  it('leave forgets every dirty section, counts the leave, and hands back the departure to let go', () => {
    const held = departure();
    expect(left({ dirty: DIRTY, pending: held, generation: 3 })).toEqual({
      patch: { pending: null, dirty: new Map(), generation: 4 },
      answer: held,
    });
    expect(left({ dirty: DIRTY, pending: null, generation: 0 }).answer).toBeNull();
  });
});

describe('unsavedLabels', () => {
  it('lists the names of the dirty sections, in the order they were marked', () => {
    expect(
      unsavedLabels(
        new Map([
          ['a', 'A'],
          ['b', 'B'],
        ]),
      ),
    ).toEqual(['A', 'B']);
    expect(unsavedLabels(new Map())).toEqual([]);
  });
});
