import { useEffect, useId, useReducer, useRef, type RefObject } from 'react';
import type { Step } from '@site/src/features/landing/services/geometry';
import {
  FLOW_START,
  flowReducer,
  playing,
  stepper,
  viewOf,
  waitFor,
  type StepperButton,
} from '@site/src/features/landing/services/playback';
import { HAND_OVER_MS } from '@site/src/features/landing/services/timing';
import { usePrefersReducedMotion } from '@site/src/shared/use-cases/usePrefersReducedMotion';
import { canObserve, watchVisible } from '@site/src/shared/platform/observe';
import { watchPageShown } from '@site/src/shared/platform/page';
import { schedule } from '@site/src/shared/platform/timers';

export interface SignInFlow {
  uid: string;
  stage: RefObject<HTMLDivElement | null>;
  step: Step;
  wantsPlay: boolean;
  label: 'Pause' | 'Play';
  live: string;
  leaving: string;
  moved: boolean;
  handOver: 'none' | 'timed' | 'click';
  marker: Step;
  widest: string;
  holdMs: number;
  running: boolean;
  politeness: 'off' | 'polite';
  buttons: StepperButton[];
  choose: (step: Step) => void;
  toggle: () => void;
  replay: () => void;
}

// A margin as well as a share, so a short landscape screen still counts the scene as in view.
const IN_VIEW = { rootMargin: '20% 0px 20% 0px', threshold: 0.4 };

// Sign-in as one scene: it plays once when it comes into view, loops after a
// rest, and waits while it is off screen, the page is hidden, or a reader has
// taken over. Reduced motion never starts it, and a rest ends it.
export function useSignInFlow(): SignInFlow {
  const uid = useId().replaceAll(':', '');
  const stage = useRef<HTMLDivElement>(null);
  const [flow, dispatch] = useReducer(flowReducer, FLOW_START);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    dispatch({ type: 'motion', allowed: !reduced && canObserve() });
    const stopPage = watchPageShown((shown) => {
      dispatch({ type: 'page', shown });
    });
    const target = stage.current;
    const stopView =
      target === null
        ? undefined
        : watchVisible(target, IN_VIEW, (visible) => {
            dispatch({ type: 'view', visible });
          });
    return () => {
      stopPage();
      stopView?.();
    };
  }, [reduced]);

  const running = playing(flow);
  useEffect(() => {
    if (!running) return undefined;
    return schedule(() => {
      dispatch({ type: 'tick' });
    }, waitFor(flow.step));
  }, [running, flow.step]);

  const view = viewOf(flow);
  const { handing } = view;
  useEffect(() => {
    if (!handing) return undefined;
    return schedule(() => {
      dispatch({ type: 'settled' });
    }, HAND_OVER_MS);
  }, [handing, flow.step]);

  return {
    uid,
    stage,
    step: flow.step,
    wantsPlay: flow.wantsPlay,
    label: view.label,
    live: view.live,
    leaving: view.leaving,
    moved: view.moved,
    handOver: view.handOver,
    marker: view.marker,
    widest: view.widest,
    holdMs: view.holdMs,
    running: view.running,
    politeness: view.politeness,
    buttons: stepper(flow.step),
    choose: (step) => {
      dispatch({ type: 'choose', step });
    },
    toggle: () => {
      dispatch({ type: 'toggle' });
    },
    replay: () => {
      dispatch({ type: 'replay' });
    },
  };
}
