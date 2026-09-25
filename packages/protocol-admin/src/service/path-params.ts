import { z } from 'zod';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

/** The one definition of a row id, shared by the router's check and the published document. */
export const rowIdSchema = z.string().regex(UUID);

/**
 * Every path parameter but `:tenant` addresses a row by id. Derived from
 * the pattern the route already declares, so a route added later is
 * narrowed by existing rather than by being remembered. Loose because
 * `:tenant` travels in the same params object and is deliberately not
 * narrowed here; a strict object would refuse it as unexpected.
 */
/** Every `:name` a pattern declares, in path order. */
export function pathParameterNames(pattern: string): string[] {
  return [...pattern.matchAll(/:(\w+)/gu)].map((match) => match[1] ?? '');
}

export function paramsSchemaFor(pattern: string): z.ZodObject | undefined {
  const ids = pathParameterNames(pattern).filter((name) => name !== 'tenant');
  if (ids.length === 0) return undefined;

  return z.looseObject(Object.fromEntries(ids.map((name) => [name, rowIdSchema])));
}
