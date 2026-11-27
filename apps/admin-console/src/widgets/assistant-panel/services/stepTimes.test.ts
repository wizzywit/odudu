import { expect, it } from 'vitest';
import {
  NO_TIMES,
  durationOf,
  recordStep,
  type StepEvent,
} from '#/widgets/assistant-panel/services/stepTimes';

const at = (id: string, kind: StepEvent['kind'], time: number): StepEvent => ({
  id,
  kind,
  at: time,
});

it('times a step from the event that began it to the event that ended it', () => {
  const begun = recordStep(NO_TIMES, at('a', 'begin', 1_000));
  expect(durationOf(begun, 'a')).toBeNull();
  expect(durationOf(recordStep(begun, at('a', 'end', 2_800)), 'a')).toBe(1_800);
});

it('keeps the first beginning and the first end', () => {
  const begun = recordStep(NO_TIMES, at('a', 'begin', 1_000));
  expect(recordStep(begun, at('a', 'begin', 5_000))).toBe(begun);
  const ended = recordStep(begun, at('a', 'end', 2_000));
  expect(recordStep(ended, at('a', 'end', 9_000))).toBe(ended);
});

it('invents no time for a step it never saw begin', () => {
  expect(recordStep(NO_TIMES, at('stored', 'end', 1_000))).toBe(NO_TIMES);
  expect(durationOf(NO_TIMES, 'stored')).toBeNull();
});

it('keeps no time for a step that stopped for a person’s decision', () => {
  const begun = recordStep(NO_TIMES, at('w', 'begin', 100));
  const waiting = recordStep(begun, at('w', 'waits', 200));
  expect(durationOf(waiting, 'w')).toBeNull();
  expect(recordStep(waiting, at('w', 'end', 60_000))).toBe(waiting);
});
