// A repository may build keys and factories at the top level.
export function recordKey(tenant: string, record: string): readonly string[] {
  return ['record', tenant, record];
}

export const listKey = (tenant: string): readonly string[] => ['list', tenant];

export function useCount(result: { ok: boolean }): boolean {
  if (!result.ok) throw new TypeError('the count could not be read at all');
  return result.ok;
}
