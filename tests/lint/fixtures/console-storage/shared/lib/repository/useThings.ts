// The fixtures typecheck under Node, which has storage but no window.
declare const window: { readonly localStorage: Storage };

export function remembered(): string | null {
  return window.localStorage.getItem('things');
}

export function kept(): void {
  globalThis.sessionStorage.setItem('things', '1');
}

const { localStorage: store } = window;
export const aliased = store;
