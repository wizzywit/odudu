import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canObserve,
  observeIntersections,
  watchVisible,
  type IntersectionConstructor,
} from '@site/src/shared/platform/observe';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Report {
  target: Element;
  isIntersecting: boolean;
}

function fakeObserver(): {
  Observer: IntersectionConstructor;
  observed: Element[];
  disconnect: ReturnType<typeof vi.fn>;
  report: (entries: Report[]) => void;
} {
  const observed: Element[] = [];
  const disconnect = vi.fn();
  let callback: (entries: Report[]) => void = () => undefined;
  class Fake {
    constructor(onReport: (entries: Report[]) => void) {
      callback = onReport;
    }
    observe(target: Element): void {
      observed.push(target);
    }
    disconnect(): void {
      disconnect();
    }
  }
  return {
    Observer: Fake as unknown as IntersectionConstructor,
    observed,
    disconnect,
    report: (entries) => {
      callback(entries);
    },
  };
}

const first = { name: 'first' } as unknown as Element;
const second = { name: 'second' } as unknown as Element;

describe('observing intersections', () => {
  it('watches every target, reports each entry, and disconnects when stopped', () => {
    const fake = fakeObserver();
    const seen: [Element, boolean][] = [];
    const stop = observeIntersections(
      [first, second],
      {},
      (target, intersecting) => seen.push([target, intersecting]),
      fake.Observer,
    );
    expect(fake.observed).toEqual([first, second]);
    fake.report([
      { target: first, isIntersecting: true },
      { target: second, isIntersecting: false },
    ]);
    expect(seen).toEqual([
      [first, true],
      [second, false],
    ]);
    stop();
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });

  it('says whether the browser has an observer at all', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(canObserve()).toBe(false);
    vi.stubGlobal('IntersectionObserver', fakeObserver().Observer);
    expect(canObserve()).toBe(true);
  });
});

describe('watching one element', () => {
  it('reports whether it is in view, and stops', () => {
    const fake = fakeObserver();
    vi.stubGlobal('IntersectionObserver', fake.Observer);
    const seen: boolean[] = [];
    const stop = watchVisible(first, {}, (visible) => seen.push(visible));
    fake.report([{ target: first, isIntersecting: true }]);
    fake.report([{ target: first, isIntersecting: false }]);
    expect(seen).toEqual([true, false]);
    stop?.();
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });

  it('watches nothing, and says so, where there is no element yet', () => {
    vi.stubGlobal('IntersectionObserver', fakeObserver().Observer);
    expect(watchVisible(null, {}, vi.fn())).toBeUndefined();
  });

  it('does nothing, and returns a stop that does nothing, without an observer', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const onChange = vi.fn();
    const stop = watchVisible(first, {}, onChange);
    stop?.();
    expect(onChange).not.toHaveBeenCalled();
  });
});
