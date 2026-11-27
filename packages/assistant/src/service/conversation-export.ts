import {
  ASSISTANT_TOOL_NAME_PATTERN,
  type AssistantConversationExport,
} from '@odudu/contracts/admin';
import type { Masker } from '#/service/mask-secrets';

type ExportedMessage = AssistantConversationExport['messages'][number];
type ExportedConversation = AssistantConversationExport['conversation'];

/** A stored message as the export reads it. */
export interface ExportableMessage {
  readonly role: string;
  readonly createdAt: Date;
  readonly parts: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

// The name of the tool a part records a call of, or none. A UI message part is
// `tool-<name>` for a catalogue tool and `dynamic-tool` with a `toolName` for
// another; a name that is not spelt as the catalogue spells them is left out.
function toolOf(part: Record<string, unknown>): string | null {
  const type = typeof part.type === 'string' ? part.type : '';
  const name =
    type === 'dynamic-tool' && typeof part.toolName === 'string'
      ? part.toolName
      : type.startsWith('tool-')
        ? type.slice('tool-'.length)
        : null;
  return name !== null && ASSISTANT_TOOL_NAME_PATTERN.test(name) ? name : null;
}

/**
 * One message as the export carries it, or none for the server's own message
 * and for one with neither text nor a tool call. The text has secrets hidden
 * by `masker`, one for the whole export so what it learns in one message hides
 * the same value in the next. A tool's input and result are never exported:
 * only that it was called.
 */
export function exportedMessageOf(
  message: ExportableMessage,
  masker: Masker,
): ExportedMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const parts = Array.isArray(message.parts) ? message.parts.map(record) : [];
  const texts = parts.flatMap((part) => {
    if (part.type !== 'text' || typeof part.text !== 'string') return [];
    const masked = masker.mask(part.text);
    return [typeof masked === 'string' ? masked : ''];
  });
  const tools = [...new Set(parts.flatMap((part) => toolOf(part) ?? []))];
  if (texts.length === 0 && tools.length === 0) return null;
  return {
    role: message.role,
    at: message.createdAt.toISOString(),
    text: texts.join('\n'),
    tools,
  };
}

/** The export as a Markdown document: the title, then each message under who said it. */
export function exportMarkdownOf(doc: AssistantConversationExport): string {
  const lines = [
    `# ${doc.conversation.title ?? 'Untitled conversation'}`,
    '',
    `Conversation ${doc.conversation.id}, started ${doc.conversation.created_at}, last used ${doc.conversation.last_active_at}. Exported ${doc.exported_at}.`,
    '',
  ];
  for (const message of doc.messages) {
    lines.push(`## ${message.role === 'user' ? 'You' : 'Assistant'} (${message.at})`, '');
    if (message.text.length > 0) lines.push(message.text, '');
    if (message.tools.length > 0) lines.push(`Tools called: ${message.tools.join(', ')}`, '');
  }
  if (doc.truncated) {
    lines.push(
      'The conversation holds more messages than this export carries: these are the first ones.',
      '',
    );
  }
  return lines.join('\n');
}

export function exportDocumentOf(
  conversation: ExportedConversation,
  messages: ExportedMessage[],
  truncated: boolean,
  now: Date,
): AssistantConversationExport {
  return { exported_at: now.toISOString(), conversation, messages, truncated };
}
