import { canObserve } from '@site/src/shared/lib/platform/observe';

// Reports whether the page is shown (not in a hidden tab); the returned function stops.
export function watchPageShown(onChange: (shown: boolean) => void): () => void {
  const report = (): void => {
    onChange(!document.hidden);
  };
  document.addEventListener('visibilitychange', report);
  return () => {
    document.removeEventListener('visibilitychange', report);
  };
}

// True where an automated browser is driving, as a capture or an audit does.
export function isAutomated(): boolean {
  return navigator.webdriver;
}

// A subscription for a value that never changes after load.
export function subscribeNever(): () => void {
  return () => undefined;
}

// Motion that waits for the page to be seen needs an observer and no automation.
export function canRevealOnScroll(): boolean {
  return canObserve() && !isAutomated();
}

// What the server says about any browser fact: no.
export function absent(): boolean {
  return false;
}
