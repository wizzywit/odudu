import {
  LAST,
  stepOf,
  playing,
  waitFor,
  type Flow,
} from '@site/src/features/landing/services/flowMachine';
import { BEATS, claimText, type Step } from '@site/src/features/landing/services/signInBeats';

export const REST_NOTE = 'Sign in once, and use every app of that tenant that trusts Odudu.';

export function captionOf(step: Step): string {
  return step === 0 ? REST_NOTE : (BEATS[step - 1]?.caption ?? REST_NOTE);
}

export function liveText(step: Step): string {
  const caption = captionOf(step);
  return step === 0 ? caption : `Step ${String(step)} of ${String(LAST)}: ${caption}`;
}

// The longest announcement, which sizes the caption box so it never has to change height.
export function widestLive(): string {
  return [0, 1, 2, 3, 4, 5, 6, 7]
    .map((step) => liveText(stepOf(step)))
    .reduce((longest, text) => (text.length > longest.length ? text : longest), '');
}

export interface FlowView {
  caption: string;
  live: string;
  // The announcement being replaced, empty until the step has changed once.
  leaving: string;
  moved: boolean;
  // What the new caption does: nothing, wait for the scene (timed), or rise at once (click).
  handOver: 'none' | 'timed' | 'click';
  // The step the marker sits under.
  marker: Step;
  // The text that sizes the caption box.
  widest: string;
  // Whether a caption hand-over is still going on, and the page waits to drop the old layer.
  handing: boolean;
  // How long the step is held, and whether its clock is running now.
  holdMs: number;
  running: boolean;
  // What the Play/Pause button does when pressed.
  label: 'Pause' | 'Play';
  // Announcements wait while the scene plays on its own, so they do not talk over it.
  politeness: 'off' | 'polite';
}

export function viewOf(flow: Flow): FlowView {
  return {
    caption: captionOf(flow.step),
    live: liveText(flow.step),
    leaving: flow.previous === flow.step ? '' : liveText(flow.previous),
    moved: flow.previous !== flow.step,
    handOver: flow.cause,
    marker: flow.marker,
    widest: widestLive(),
    handing: flow.cause !== 'none',
    holdMs: waitFor(flow.step),
    running: playing(flow),
    label: flow.wantsPlay ? 'Pause' : 'Play',
    politeness: flow.wantsPlay ? 'off' : 'polite',
  };
}

export interface StepperButton {
  step: Step;
  number: string;
  label: string;
  short: string;
  current: 'step' | undefined;
}

export function stepper(step: Step): StepperButton[] {
  return BEATS.map((beat, index) => {
    const own = stepOf(index + 1);
    return {
      step: own,
      number: String(own),
      label: beat.label,
      short: beat.short,
      current: step === own ? 'step' : undefined,
    };
  });
}

export interface CaptionItem {
  label: string;
  caption: string;
  hasClaims: boolean;
  claims: { id: string; text: string }[];
}

// Each beat's caption and the sign-in methods it names, for the list shown without script.
export function captions(): CaptionItem[] {
  return BEATS.map((beat) => ({
    label: beat.label,
    caption: beat.caption,
    hasClaims: beat.claims.length > 0,
    claims: beat.claims.map((id) => ({ id, text: claimText(id) })),
  }));
}
