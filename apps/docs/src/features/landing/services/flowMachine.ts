import { BEATS, type Step } from '@site/src/features/landing/services/signInBeats';

export const LAST = BEATS.length;
// How long the finished scene rests before it starts again.
export const REST_MS = 3000;

export function stepOf(value: number): Step {
  return Math.min(Math.max(value, 0), LAST) as Step;
}

// How long a step is shown: a beat of its own, or the rest after the last.
export function waitFor(step: Step): number {
  return step === 0 ? REST_MS : (BEATS[step - 1]?.ms ?? 2000);
}

export interface Advance {
  step: Step;
  // False where the round ends for good: a rest under reduced motion.
  keepPlaying: boolean;
}

export function advance(step: Step, motion: boolean): Advance {
  if (step === 0) return motion ? { step: 1, keepPlaying: true } : { step: 0, keepPlaying: false };
  return { step: step >= LAST ? 0 : stepOf(step + 1), keepPlaying: true };
}

export interface Flow {
  step: Step;
  // The step the scene came from, whose caption is handed over to the new one.
  previous: Step;
  // How the last move came about, until its hand-over has settled.
  cause: 'none' | 'timed' | 'click';
  // The step the marker sits under: the last one shown, kept while the scene rests.
  marker: Step;
  wantsPlay: boolean;
  inView: boolean;
  pageShown: boolean;
  // A reader has taken over: the scene never starts by itself after this.
  chosen: boolean;
  started: boolean;
  // Whether the scene may move on its own: motion is welcome and the browser can watch it.
  motion: boolean;
}

export type FlowEvent =
  | { type: 'motion'; allowed: boolean }
  | { type: 'view'; visible: boolean }
  | { type: 'page'; shown: boolean }
  | { type: 'tick' }
  | { type: 'settled' }
  | { type: 'choose'; step: Step }
  | { type: 'toggle' }
  | { type: 'replay' };

export const FLOW_START: Flow = {
  step: 0,
  previous: 0,
  cause: 'none',
  marker: 1,
  wantsPlay: false,
  inView: false,
  pageShown: true,
  chosen: false,
  started: false,
  motion: false,
};

// The scene may move on its own for a reader who welcomes motion, where the browser can watch it.
export function sceneMotionAllowed(reduced: boolean, observable: boolean): boolean {
  return !reduced && observable;
}

// The scene runs only while it is wanted, on screen and on a visible page.
export function playing(flow: Flow): boolean {
  return flow.wantsPlay && flow.inView && flow.pageShown;
}

// Moves to a step. Only a caption that was fully shown leaves: a move made while the last
// hand-over is still going lets nothing leave, so a caption never seen is never shown going.
function moveTo(flow: Flow, step: Step, cause: 'timed' | 'click'): Flow {
  if (step === flow.step) return flow;
  const shown = flow.cause === 'none';
  return {
    ...flow,
    step,
    previous: shown ? flow.step : step,
    cause,
    marker: step === 0 ? flow.marker : step,
  };
}

export function flowReducer(flow: Flow, event: FlowEvent): Flow {
  switch (event.type) {
    case 'motion':
      return {
        ...flow,
        motion: event.allowed,
        started: false,
        wantsPlay: event.allowed && flow.wantsPlay,
      };
    case 'settled':
      return { ...flow, previous: flow.step, cause: 'none' };
    case 'page':
      return { ...flow, pageShown: event.shown };
    case 'view': {
      const seen = { ...flow, inView: event.visible };
      const begins = event.visible && !flow.chosen && !flow.started && flow.motion;
      return begins ? { ...moveTo(seen, 1, 'timed'), started: true, wantsPlay: true } : seen;
    }
    case 'tick': {
      const next = advance(flow.step, flow.motion);
      return { ...moveTo(flow, next.step, 'timed'), wantsPlay: next.keepPlaying };
    }
    case 'choose':
      return { ...moveTo(flow, event.step, 'click'), chosen: true, wantsPlay: false };
    case 'toggle':
      if (flow.wantsPlay) return { ...flow, chosen: true, wantsPlay: false };
      return {
        ...moveTo(flow, flow.step === 0 ? 1 : flow.step, 'click'),
        chosen: true,
        wantsPlay: true,
      };
    case 'replay':
      return { ...moveTo(flow, 1, 'click'), chosen: true, wantsPlay: true };
  }
}
