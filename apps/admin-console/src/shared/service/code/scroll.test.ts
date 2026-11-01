import { afterEach, describe, expect, it, vi } from 'vitest';
import { caretAt, scrollTarget, type Metrics, type Viewport } from '#/shared/service/code';

describe('caretAt', () => {
  it('counts lines and columns, a tab as its width', () => {
    expect(caretAt('', 0, 2)).toEqual({ line: 0, column: 0 });
    expect(caretAt('ab\ncd', 4, 2)).toEqual({ line: 1, column: 1 });
    expect(caretAt('\tab', 3, 2)).toEqual({ line: 0, column: 4 });
    expect(caretAt('a\n\n\nb', 99, 2)).toEqual({ line: 3, column: 1 });
  });

  describe('the work it does', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reads no more of the text than the caret is into it', () => {
      const text = 'x\n'.repeat(70_000);
      const reads = vi.spyOn(String.prototype, 'charCodeAt');
      expect(caretAt(text, 5000, 2).line).toBe(2500);
      expect(reads.mock.calls.length).toBeLessThanOrEqual(5000);
    });
  });
});

describe('scrollTarget', () => {
  const metrics: Metrics = {
    lineHeight: 20,
    charWidth: 8,
    originX: 60,
    originY: 10,
    inset: 50,
  };
  const view = (changes: Partial<Viewport> = {}): Viewport => ({
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 200,
    clientWidth: 400,
    ...changes,
  });

  it('leaves a caret that shows where it is', () => {
    expect(scrollTarget({ line: 3, column: 5 }, metrics, view())).toEqual({
      top: null,
      left: null,
    });
  });

  it('brings a caret above the view down to it, with a line of margin', () => {
    expect(scrollTarget({ line: 2, column: 0 }, metrics, view({ scrollTop: 600 })).top).toBe(30);
    expect(scrollTarget({ line: 0, column: 0 }, metrics, view({ scrollTop: 600 })).top).toBe(0);
  });

  it('brings a caret below the view up to it', () => {
    expect(scrollTarget({ line: 100, column: 0 }, metrics, view()).top).toBe(
      10 + 100 * 20 + 20 + 20 - 200,
    );
  });

  it('brings a caret to the right of the view, and to the left behind the gutter, into it', () => {
    const right = scrollTarget({ line: 0, column: 300 }, metrics, view());
    expect(right.left).toBe(60 + 300 * 8 + 8 + 32 - 400);
    const left = scrollTarget({ line: 0, column: 120 }, metrics, view({ scrollLeft: 1500 }));
    expect(left.left).toBe(60 + 120 * 8 - 32 - 50);
    expect(scrollTarget({ line: 0, column: 0 }, metrics, view({ scrollLeft: 900 })).left).toBe(0);
  });
});
