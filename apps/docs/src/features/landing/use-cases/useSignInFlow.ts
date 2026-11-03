import { useEffect, useId, useReducer, useRef, type RefObject } from 'react';
import type { Step } from '@site/src/features/landing/services/signInBeats';
import {
  FLOW_START,
  flowReducer,
  playing,
  sceneMotionAllowed,
  waitFor,
} from '@site/src/features/landing/services/flowMachine';
import {
  captions,
  stepper,
  viewOf,
  type CaptionItem,
  type FlowView,
  type StepperButton,
} from '@site/src/features/landing/services/flowView';
import { scenesAt, type SceneModel } from '@site/src/features/landing/services/sceneModel';
import { HAND_OVER_MS } from '@site/src/features/landing/services/timing';
import { usePrefersReducedMotion } from '@site/src/shared/lib/use-cases/usePrefersReducedMotion';
import { canObserve, watchVisible } from '@site/src/shared/lib/platform/observe';
import { watchPageShown } from '@site/src/shared/lib/platform/page';
import { schedule } from '@site/src/shared/lib/platform/timers';

export interface SignInFlow {
  uid: string;
  stage: RefObject<HTMLDivElement | null>;
  step: Step;
  wantsPlay: boolean;
  view: FlowView;
  scenes: { wide: SceneModel; tall: SceneModel };
  captions: CaptionItem[];
  buttons: StepperButton[];
  choose: (step: Step) => void;
  toggle: () => void;
  replay: () => void;
}

// What the page says under the scene, the same for every step.
const CAPTIONS = captions();

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
    dispatch({ type: 'motion', allowed: sceneMotionAllowed(reduced, canObserve()) });
    const stopPage = watchPageShown((shown) => {
      dispatch({ type: 'page', shown });
    });
    const target = stage.current;
    const stopView = watchVisible(target, IN_VIEW, (visible) => {
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
    view,
    scenes: scenesAt(flow.step),
    captions: CAPTIONS,
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
