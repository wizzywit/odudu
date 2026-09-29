// One field that another administrator changed while this one was editing
// it: their value is what the record holds now, yours is the unsaved edit.
export interface Conflict {
  readonly field: string;
  readonly label: string;
  readonly theirs: unknown;
  readonly yours: unknown;
  // A secret's value is never shown, not even to say that it differs.
  readonly secret: boolean;
  // How the field reads its value, where describeValue would not do: a
  // lifetime shown with its duration, say.
  readonly describe?: ((value: unknown) => string) | undefined;
}

export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'string') return value === '' ? 'empty' : value;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map((item) => describeValue(item)).join(', ');
  }
  return JSON.stringify(value);
}
