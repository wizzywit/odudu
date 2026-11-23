export function currentUrl(): string {
  return window.location.href;
}

export function navigate(url: string): void {
  window.location.assign(url);
}

// Replaces the address in the history entry; the page does not reload.
export function replaceUrl(relative: string): void {
  window.history.replaceState(window.history.state, '', relative);
}
