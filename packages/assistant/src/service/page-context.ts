import { assistantPageContextSchema, type AssistantPageContext } from '@odudu/contracts/admin';

/** The part type a conversation's first, system message carries its page context in. */
export const PAGE_CONTEXT_PART = 'data-page-context';

/** A stored page context, or null when what is stored is not one. */
export function readPageContext(parts: unknown): AssistantPageContext | null {
  if (!Array.isArray(parts)) return null;
  const first: unknown = parts[0];
  if (typeof first !== 'object' || first === null) return null;
  const { type, data } = first as { type?: unknown; data?: unknown };
  if (type !== PAGE_CONTEXT_PART) return null;
  const parsed = assistantPageContextSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Where the administrator is, in words. Every value passed a pattern that
 * admits no space or quote, so none is text a person wrote.
 */
export function pageContextText(context: AssistantPageContext | null): string {
  if (context === null) return '';
  const where = `The administrator has the console page ${context.route} open.`;
  if (context.objectType === undefined || context.objectId === undefined) return where;
  return `${where} It shows the ${context.objectType} ${context.objectId}.`;
}
