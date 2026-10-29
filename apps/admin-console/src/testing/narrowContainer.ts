import { afterEach, beforeEach, vi } from 'vitest';

// Stands in for the width of every element marked `data-narrow-container`,
// which jsdom does not lay out, and for the observer that watches it.
export function useContainerWidth(width: number): void {
  beforeEach(() => {
    class Watch {
      private readonly callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
      }
      observe(): void {
        this.callback();
      }
      disconnect(): void {
        return undefined;
      }
    }
    vi.stubGlobal('ResizeObserver', Watch);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function boxOf(
      this: HTMLElement,
    ): DOMRect {
      const size = this.hasAttribute('data-narrow-container') ? width : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: size,
        bottom: 0,
        width: size,
        height: 0,
      } as DOMRect;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}
