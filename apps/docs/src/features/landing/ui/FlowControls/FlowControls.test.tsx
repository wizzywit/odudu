import { describe, expect, it, vi } from 'vitest';
import {
  FLOW_START,
  liveText,
  widestLive,
  stepOf,
  stepper,
  viewOf,
  waitFor,
} from '@site/src/features/landing/services/playback';
import { FlowControls } from '@site/src/features/landing/ui/FlowControls/FlowControls';
import { markupOf } from '@site/tests/support/markup';

const NOOP = vi.fn();

function controls(
  step: number,
  wantsPlay: boolean,
  live: string,
  previous = step,
): React.ReactElement {
  const flow = {
    ...FLOW_START,
    cause: previous === step ? ('none' as const) : ('timed' as const),
    step: stepOf(step),
    previous: stepOf(previous),
    wantsPlay,
    inView: true,
  };
  const view = viewOf(flow);
  return (
    <FlowControls
      step={flow.step}
      buttons={stepper(flow.step)}
      playing={wantsPlay}
      running={view.running}
      holdMs={view.holdMs}
      label={view.label}
      live={live}
      leaving={view.leaving}
      moved={view.moved}
      handOver={view.handOver}
      marker={view.marker}
      widest={view.widest}
      politeness={view.politeness}
      onChoose={NOOP}
      onToggle={NOOP}
      onReplay={NOOP}
    />
  );
}

describe('FlowControls', () => {
  it('puts the toggle first, named by its action and pressed while playing', () => {
    const $ = markupOf(controls(2, true, 'Step 2'));
    const first = $('button').first();
    expect(first.text()).toBe('Pause');
    expect(first.attr('aria-label')).toBe('Pause autoplay');
    expect(first.attr('aria-pressed')).toBe('true');
    expect($('button').eq(1).text()).toBe('Replay');
  });

  it('lists the seven steps and marks only the current one', () => {
    const $ = markupOf(controls(3, false, ''));
    expect($('[role="group"] button')).toHaveLength(7);
    expect($('[aria-current="step"]')).toHaveLength(1);
    expect($('[aria-current="step"]').text()).toContain('Sign in once');
  });

  it('announces politely when paused and not at all while playing', () => {
    expect(markupOf(controls(1, true, 'x'))('[role="status"]').attr('aria-live')).toBe('off');
    expect(markupOf(controls(1, false, 'x'))('[role="status"]').attr('aria-live')).toBe('polite');
  });

  it('has one marker, which says which step it is under and fills while the step runs', () => {
    const playing = markupOf(controls(3, true, 'x'));
    expect(playing('[data-pill]')).toHaveLength(1);
    expect(playing('[role="group"]').attr('data-step')).toBe('3');
    expect(playing('[data-fill]')).toHaveLength(1);
    expect(playing('[data-fill]').attr('style')).toContain(`${String(waitFor(3))}ms`);
    expect(markupOf(controls(3, false, 'x'))('[data-fill]')).toHaveLength(0);
  });

  it('shows the new caption alone at first, and hands over from the old one after a move', () => {
    const first = markupOf(controls(1, true, 'now'));
    expect(first('[data-caption="out"]')).toHaveLength(0);
    expect(first('[data-caption="in"]').attr('data-hand-over')).toBe('none');
    const moved = markupOf(controls(2, true, 'now', 1));
    expect(moved('[data-caption="out"]').text()).toBe(liveText(1));
    expect(moved('[data-caption="out"]').attr('aria-hidden')).toBe('true');
    expect(moved('[data-caption="in"]').text()).toBe('now');
    expect(moved('[data-caption="in"]').attr('data-hand-over')).toBe('timed');
    expect(moved('[data-caption="sizer"]').text()).toBe(widestLive());
  });
});
