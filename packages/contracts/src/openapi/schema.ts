import type { z } from 'zod';

export type JsonSchema = z.core.JSONSchema.BaseSchema;

export const COMPONENT_PREFIX = '#/components/schemas/';

export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function without(node: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([name]) => name !== key));
}
