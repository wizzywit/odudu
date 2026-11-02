// A role or scope a copy left out because the caller could not give it, and why.
export interface LeftOut {
  name: string;
  why: string;
}

// A copy missing some of its parts stays on the page, with where to finish it.
export interface PartialCopy {
  text: string;
  href: string;
  name: string;
}

// Create is held while a write is under way, the source is being read, or
// the caller is not yet known.
export type CopySourceStatus = 'none' | 'loading' | 'failed' | 'ready';

export function copyBusy(
  busy: boolean,
  source: CopySourceStatus,
  caller: readonly string[] | undefined,
): boolean {
  return busy || source === 'loading' || caller === undefined;
}

// A copy part-made stays on the page, so another is held back as well.
export function copyBlocked(
  busy: boolean,
  partial: PartialCopy | null,
  source: CopySourceStatus,
  caller: readonly string[] | undefined,
): boolean {
  return partial !== null || copyBusy(busy, source, caller);
}

// What a copy is read as: nothing to copy, the source being read, a source
// that could not be, or the source and whatever it is made of. A source
// that was read and came to nothing is failed like one that errored.
export function copyReadOf<S extends object & { status?: never }>(
  id: string | null,
  source: S | null | undefined,
  isError: boolean,
): { status: 'none' } | { status: 'loading' } | { status: 'failed' } | ({ status: 'ready' } & S) {
  if (id === null) return { status: 'none' };
  if (source === undefined) return isError ? { status: 'failed' } : { status: 'loading' };
  return source === null ? { status: 'failed' } : { status: 'ready', ...source };
}

// An edited description wins, even an emptied one; otherwise the source's.
export function copiedDescription(edited: string | null, source: string | null): string {
  return edited ?? source ?? '';
}
