// Where a page of acceptances ends: the instant and the version of its last
// row, which together order the list, written as one cursor position.
export interface AcceptancePosition {
  readonly acceptedAt: Date;
  readonly version: string;
}

export function acceptanceCursorOf(row: AcceptancePosition): string {
  return JSON.stringify([row.acceptedAt.toISOString(), row.version]);
}

// Undefined for a position that is not one this server wrote.
export function acceptanceFromCursor(after: string | undefined): AcceptancePosition | undefined {
  if (after === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(after);
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [at, version] = parsed as unknown[];
    if (typeof at !== 'string' || typeof version !== 'string') return undefined;
    const acceptedAt = new Date(at);
    return Number.isNaN(acceptedAt.getTime()) ? undefined : { acceptedAt, version };
  } catch {
    return undefined;
  }
}
