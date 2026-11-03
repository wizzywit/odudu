import { describe, expect, it } from 'vitest';
import { BEATS } from '@site/src/features/landing/services/signInBeats';
import {
  LAST,
  REST_MS,
  REST_NOTE,
  FLOW_START,
  advance,
  captions,
  widestLive,
  flowReducer,
  playing,
  stepper,
  viewOf,
  type Flow,
  type FlowEvent,
  captionOf,
  liveText,
  stepOf,
  waitFor,
} from '@site/src/features/landing/services/playback';

describe('the sign-in scene playback', () => {
  it('clamps a step into the scene, with 0 as rest', () => {
    expect([stepOf(-3), stepOf(0), stepOf(4), stepOf(99)]).toEqual([0, 0, 4, LAST]);
  });

  it('shows each beat for its own time and the rest for three seconds', () => {
    expect(waitFor(0)).toBe(REST_MS);
    expect(REST_MS).toBe(3000);
    BEATS.forEach((beat, index) => {
      expect(waitFor(stepOf(index + 1))).toBe(beat.ms);
    });
  });

  it('goes through every step in order, rests after the last and starts again', () => {
    const seen = [1, 2, 3, 4, 5, 6, 7].map((step) => advance(stepOf(step), true).step);
    expect(seen).toEqual([2, 3, 4, 5, 6, 7, 0]);
    expect(advance(0, true)).toEqual({ step: 1, keepPlaying: true });
  });

  it('ends a round at the rest where motion is not welcome', () => {
    expect(advance(0, false)).toEqual({ step: 0, keepPlaying: false });
    expect(advance(3, false)).toEqual({ step: 4, keepPlaying: true });
  });

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

function run(from: Flow, ...events: FlowEvent[]): Flow {
  return events.reduce(flowReducer, from);
}

const READY: Flow = run(FLOW_START, { type: 'motion', allowed: true });

describe('the sign-in scene state machine', () => {
  it('plays only while wanted, on screen and on a shown page', () => {
    const on = { ...READY, wantsPlay: true, inView: true };
    expect(playing(on)).toBe(true);
    expect(playing({ ...on, wantsPlay: false })).toBe(false);
    expect(playing({ ...on, inView: false })).toBe(false);
    expect(playing({ ...on, pageShown: false })).toBe(false);
  });

  it('starts on first entry only', () => {
    const entered = run(READY, { type: 'view', visible: true });
    expect(entered).toMatchObject({ step: 1, wantsPlay: true, started: true });
    const again = run(entered, { type: 'view', visible: false }, { type: 'view', visible: true });
    expect(again.step).toBe(1);
    expect(
      run(
        again,
        { type: 'tick' },
        { type: 'view', visible: false },
        { type: 'view', visible: true },
      ).step,
    ).toBe(2);
  });

  it('does not start when a reader has chosen, or motion is not allowed', () => {
    expect(run(READY, { type: 'choose', step: 4 }, { type: 'view', visible: true })).toMatchObject({
      step: 4,
      wantsPlay: false,
    });
    expect(run(FLOW_START, { type: 'view', visible: true }).wantsPlay).toBe(false);
  });

  it('starts again on entry when motion becomes allowed after being refused', () => {
    const refused = run(FLOW_START, { type: 'view', visible: true });
    expect(
      run(refused, { type: 'motion', allowed: true }, { type: 'view', visible: true }).wantsPlay,
    ).toBe(true);
  });

  it('ticks through the steps, loops, and ends a round at the rest without motion', () => {
    const last: Flow = { ...READY, step: stepOf(LAST), wantsPlay: true };
    expect(run(last, { type: 'tick' })).toMatchObject({ step: 0, wantsPlay: true });
    expect(run({ ...FLOW_START, wantsPlay: true }, { type: 'tick' })).toMatchObject({
      step: 0,
      wantsPlay: false,
    });
  });

  it('lets a reader choose, toggle and replay, each taking over', () => {
    const playingNow = run(READY, { type: 'view', visible: true }, { type: 'tick' });
    expect(run(playingNow, { type: 'toggle' })).toMatchObject({
      step: 2,
      wantsPlay: false,
      chosen: true,
    });
    expect(run(FLOW_START, { type: 'toggle' })).toMatchObject({
      step: 1,
      wantsPlay: true,
      chosen: true,
    });
    expect(run({ ...READY, step: stepOf(5) }, { type: 'toggle' })).toMatchObject({
      step: 5,
      wantsPlay: true,
    });
    expect(run({ ...READY, step: stepOf(5) }, { type: 'replay' })).toMatchObject({
      step: 1,
      wantsPlay: true,
      chosen: true,
    });
    expect(run(playingNow, { type: 'choose', step: 6 })).toMatchObject({
      step: 6,
      wantsPlay: false,
      chosen: true,
    });
  });

  it('follows the page being hidden', () => {
    expect(run(READY, { type: 'page', shown: false }).pageShown).toBe(false);
  });

  it('remembers the step it came from, and only when the step changes', () => {
    const ticked = run(
      READY,
      { type: 'view', visible: true },
      { type: 'settled' },
      { type: 'tick' },
    );
    expect(ticked).toMatchObject({ step: 2, previous: 1 });
    const settled = run(ticked, { type: 'settled' });
    expect(run(settled, { type: 'choose', step: 2 }).previous).toBe(2);
    expect(run(settled, { type: 'choose', step: 6 })).toMatchObject({ step: 6, previous: 2 });
    expect(run(settled, { type: 'replay' })).toMatchObject({ step: 1, previous: 2 });
    expect(run(FLOW_START, { type: 'toggle' })).toMatchObject({ step: 1, previous: 0 });
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
  const playingFlow = run(READY, { type: 'view', visible: true });

  it('says whether a step came from the clock or a click', () => {
    expect(run(playingFlow, { type: 'tick' }).cause).toBe('timed');
    expect(run(playingFlow, { type: 'choose', step: 5 }).cause).toBe('click');
    expect(run(FLOW_START, { type: 'toggle' }).cause).toBe('click');
    expect(run(playingFlow, { type: 'choose', step: 3 }, { type: 'replay' }).cause).toBe('click');
    expect(playingFlow.cause).toBe('timed');
  });

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

  it('keeps the marker on the last step when the scene returns to rest', () => {
    const last = run(READY, { type: 'choose', step: 7 });
    expect(last.marker).toBe(7);
    const rest = run({ ...last, wantsPlay: true }, { type: 'tick' });
    expect(rest).toMatchObject({ step: 0, marker: 7 });
    expect(FLOW_START.marker).toBe(1);
  });

  it('stops playing when motion stops being welcome', () => {
    const going = run(READY, { type: 'view', visible: true });
    expect(going.wantsPlay).toBe(true);
    expect(run(going, { type: 'motion', allowed: false })).toMatchObject({
      wantsPlay: false,
      motion: false,
    });
    expect(run(going, { type: 'motion', allowed: true }).wantsPlay).toBe(true);
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
