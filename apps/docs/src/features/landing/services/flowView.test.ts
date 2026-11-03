import { describe, expect, it } from 'vitest';
import {
  LAST,
  FLOW_START,
  flowReducer,
  stepOf,
  waitFor,
  type Flow,
  type FlowEvent,
} from '@site/src/features/landing/services/flowMachine';
import {
  REST_NOTE,
  captionOf,
  captions,
  liveText,
  stepper,
  viewOf,
  widestLive,
} from '@site/src/features/landing/services/flowView';
import { BEATS } from '@site/src/features/landing/services/signInBeats';

function run(from: Flow, ...events: FlowEvent[]): Flow {
  return events.reduce(flowReducer, from);
}

const READY: Flow = run(FLOW_START, { type: 'motion', allowed: true });

describe('the sign-in scene captions', () => {
  it('words the caption and the announcement, and the toggle by its action', () => {
    expect(captionOf(0)).toBe(REST_NOTE);
    expect(captionOf(1)).toBe(BEATS[0]?.caption);
    expect(liveText(0)).toBe(REST_NOTE);
    expect(liveText(3)).toBe(`Step 3 of 7: ${BEATS[2]?.caption ?? ''}`);
  });

  it('words the toggle by its action', () => {
    expect(viewOf({ ...FLOW_START, wantsPlay: true }).label).toBe('Pause');
    expect(viewOf(FLOW_START).label).toBe('Play');
    expect(viewOf({ ...FLOW_START, wantsPlay: true }).politeness).toBe('off');
    expect(viewOf(FLOW_START).politeness).toBe('polite');
    expect(viewOf({ ...FLOW_START, step: stepOf(3) }).live).toBe(liveText(3));
  });

  it('marks the current step button and numbers each from one', () => {
    const buttons = stepper(3);
    expect(buttons.map((button) => button.number)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(
      buttons.filter((button) => button.current === 'step').map((button) => button.step),
    ).toEqual([3]);
    expect(stepper(0).every((button) => button.current === undefined)).toBe(true);
  });

  it('lists each beat with the methods it names', () => {
    const list = captions();
    expect(list).toHaveLength(LAST);
    list.forEach((item, index) => {
      expect(item.hasClaims).toBe((BEATS[index]?.claims.length ?? 0) > 0);
      expect(item.claims).toHaveLength(BEATS[index]?.claims.length ?? 0);
    });
  });
});

describe('the caption hand-over', () => {
  it('has nothing leaving until the step has changed once', () => {
    expect(viewOf(FLOW_START)).toMatchObject({ leaving: '', moved: false, handOver: 'none' });
  });

  it('hands the old announcement over to the new one', () => {
    const flow: Flow = { ...READY, step: stepOf(3), previous: stepOf(2) };
    const view = viewOf(flow);
    expect(view.leaving).toBe(liveText(2));
    expect(view.live).toBe(liveText(3));
    expect(view.moved).toBe(true);
  });

  it('carries the step clock and whether it is running', () => {
    const flow: Flow = { ...READY, step: stepOf(3), wantsPlay: true, inView: true };
    expect(viewOf(flow)).toMatchObject({ holdMs: waitFor(3), running: true });
    expect(viewOf({ ...flow, inView: false }).running).toBe(false);
  });
});

describe('the hand-over of a step', () => {
  it('lets only a caption that was fully shown leave', () => {
    const moved = run(READY, { type: 'choose', step: 3 }, { type: 'settled' });
    const first = run(moved, { type: 'choose', step: 4 });
    expect(first).toMatchObject({ step: 4, previous: 3 });
    const second = run(first, { type: 'choose', step: 5 });
    expect(second).toMatchObject({ step: 5, previous: 5, cause: 'click' });
    expect(viewOf(second).moved).toBe(false);
  });

  it('drops the leaving caption once settled', () => {
    const moved = run(READY, { type: 'choose', step: 3 }, { type: 'choose', step: 4 });
    expect(viewOf(moved).moved).toBe(false);
    const settled = run(
      { ...READY, step: stepOf(2), previous: stepOf(1), cause: 'timed' },
      { type: 'settled' },
    );
    expect(settled).toMatchObject({ previous: 2, cause: 'none' });
    expect(viewOf(settled)).toMatchObject({ leaving: '', moved: false, handOver: 'none' });
  });
});

describe('the stepper labels', () => {
  it('shows a short label that the full label contains, so the name holds what is seen', () => {
    for (const button of stepper(0)) {
      expect(button.label.toLowerCase()).toContain(button.short.toLowerCase());
      expect(button.short.length).toBeLessThanOrEqual(12);
    }
  });
});

describe('the caption box size', () => {
  it('is set by the longest announcement of all, rest included', () => {
    const widest = widestLive();
    for (const step of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(widest.length).toBeGreaterThanOrEqual(liveText(stepOf(step)).length);
    }
    expect(viewOf(FLOW_START).widest).toBe(widest);
  });

  it('says a hand-over is going on from a move until it has settled', () => {
    const moved = run(READY, { type: 'choose', step: 2 });
    expect(viewOf(moved).handing).toBe(true);
    expect(viewOf(run(moved, { type: 'settled' })).handing).toBe(false);
    expect(viewOf(FLOW_START).handing).toBe(false);
  });
});
