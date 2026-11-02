import { MESSAGE_LABEL } from '#/features/failure/services';

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// Vite replaces this with a constant, so a production build holds no branch.
export function isDevelopment(): boolean {
  return import.meta.env.DEV;
}

// The label is named only inside the build-mode branch, which Vite folds to
// nothing in production, so the string is not in the shipped bundle.
export function developmentMessageLabel(): string {
  return import.meta.env.DEV ? MESSAGE_LABEL : '';
}

export function logError(line: string, error: unknown, componentStack?: string): void {
  if (componentStack === undefined) console.error(line, error);
  else console.error(line, error, componentStack);
}

export function reloadPage(): void {
  window.location.reload();
}

export function focusMain(): void {
  document.getElementById('main')?.focus();
}
