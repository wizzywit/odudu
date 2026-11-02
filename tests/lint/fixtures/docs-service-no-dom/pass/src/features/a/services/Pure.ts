export interface Timers<Handle> {
  set: (run: () => void, ms: number) => Handle;
  clear: (handle: Handle | undefined) => void;
}

export function area(top: number, viewport: number): number {
  return top + viewport;
}

export const record = { document: 'a', navigator: 'b' };
export const getBoundingClientRectName = 'getBoundingClientRect';
