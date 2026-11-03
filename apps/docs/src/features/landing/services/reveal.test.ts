import { describe, expect, it } from 'vitest';
import {
  belowFold,
  motionMark,
  reached,
  revealWanted,
  startReveal,
  type RevealHost,
  type RevealItem,
} from '@site/src/features/landing/services/reveal';

describe('the reveal decisions', () => {
  it('holds back only what starts at or below the bottom of the screen', () => {
    expect(belowFold(800, 800)).toBe(true);
    expect(belowFold(799, 800)).toBe(false);
    expect(belowFold(-50, 800)).toBe(false);
  });

  it('releases what has come up into the screen or been scrolled past', () => {
    expect(reached(700, 800)).toBe(true);
    expect(reached(-4000, 800)).toBe(true);
    expect(reached(740, 800)).toBe(false);
  });
});

interface Fake extends RevealItem {
  name: string;
  held: boolean;
  at: number;
}

function fake(name: string, at: number): Fake {
  const item: Fake = {
    name,
    at,
    held: false,
    top: () => item.at,
    hold: () => {
      item.held = true;
    },
    release: () => {
      item.held = false;
    },
  };
  return item;
}

function hostOf(items: Fake[], overrides: Partial<RevealHost<Fake>> = {}) {
  const log = {
    seen: undefined as ((item: Fake) => void) | undefined,
    scroll: undefined as (() => void) | undefined,
    frames: [] as (() => void)[],
    stopped: [] as string[],
  };
  const host: RevealHost<Fake> = {
    items: () => items,
    viewport: () => 800,
    watch: (_items, seen) => {
      log.seen = seen;
      return () => log.stopped.push('watch');
    },
    scrolled: (handler) => {
      log.scroll = handler;
      return () => log.stopped.push('scroll');
    },
    frame: (run) => {
      log.frames.push(run);
      return () => log.stopped.push('frame');
    },
    ...overrides,
  };
  return { host, log };
}

describe('starting the reveal', () => {
  it('holds back only what is below the first screen', () => {
    const items = [fake('top', 100), fake('low', 900), fake('lower', 2000)];
    const { host } = hostOf(items);
    expect(startReveal(host)).toBeTypeOf('function');
    expect(items.map((item) => item.held)).toEqual([false, true, true]);
  });

  it('releases an item the observer reports, once', () => {
    const low = fake('low', 900);
    const { host, log } = hostOf([low]);
    startReveal(host);
    log.seen?.(low);
    expect(low.held).toBe(false);
  });

  it('releases what a scroll has brought up or passed, on the next frame', () => {
    const first = fake('a', 900);
    const items = [first, fake('b', 3000)];
    const { host, log } = hostOf(items);
    startReveal(host);
    first.at = -4000;
    log.scroll?.();
    log.scroll?.();
    expect(log.frames).toHaveLength(1);
    log.frames[0]?.();
    expect(items.map((item) => item.held)).toEqual([false, true]);
    log.scroll?.();
    expect(log.frames).toHaveLength(2);
  });

  it('puts everything back, and stops watching, when stopped', () => {
    const items = [fake('a', 900), fake('b', 3000)];
    const { host, log } = hostOf(items);
    const stop = startReveal(host);
    log.scroll?.();
    stop?.();
    expect(items.every((item) => !item.held)).toBe(true);
    expect(log.stopped).toEqual(['watch', 'scroll', 'frame']);
  });

  it('leaves the page as it was where the browser cannot do it', () => {
    const items = [fake('a', 900)];
    const { host } = hostOf(items, {
      watch: () => {
        throw new Error('no observer');
      },
    });
    expect(startReveal(host)).toBeUndefined();
    expect(items[0]?.held).toBe(false);
  });
});

describe('the page mark', () => {
  it('marks the page only once the reveal has taken hold', () => {
    expect(motionMark(true)).toBe('ok');
    expect(motionMark(false)).toBeUndefined();
  });
});

describe('when the reveal is wanted', () => {
  it('wants it only where the browser can and the reader welcomes motion', () => {
    expect(revealWanted(true, false)).toBe(true);
    expect(revealWanted(true, true)).toBe(false);
    expect(revealWanted(false, false)).toBe(false);
    expect(revealWanted(false, true)).toBe(false);
  });
});
