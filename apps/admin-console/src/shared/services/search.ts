export type SearchValue = string | readonly string[];

// Position lives in the URL as plain parameters, a list as the parameter
// repeated — the shape the cursor trail uses — rather than the router's
// default of JSON inside a parameter.
export function parseSearch(search: string): Record<string, SearchValue> {
  const parsed: Record<string, SearchValue> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const seen = parsed[key];
    parsed[key] =
      seen === undefined ? value : [...(typeof seen === 'string' ? [seen] : seen), value];
  }
  return parsed;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const values: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        params.append(key, String(item));
      }
    }
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
