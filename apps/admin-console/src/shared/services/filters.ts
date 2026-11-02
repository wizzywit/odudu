export const STATUS_FILTER = [
  { id: 'any', label: 'Any status' },
  { id: 'true', label: 'Enabled' },
  { id: 'false', label: 'Disabled' },
];

export const NAME_SEARCH = [{ id: 'name', label: 'Name' }];

// A filter that is sent only once it names something: `{ status }`, or nothing.
export function optionalFilter(
  name: string,
  value: string | null | undefined,
): Record<string, string> {
  return value === null || value === undefined ? {} : { [name]: value };
}

// The choice that sends no status filter, for a list a status narrows.
export const ANY_STATUS = 'any';

// A filter the server takes, or none for any.
export function statusFilter(choice: string): string | null {
  return choice === ANY_STATUS ? null : choice;
}
