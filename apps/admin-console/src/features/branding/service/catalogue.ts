import type { MessageCatalogueResponse } from '@odudu/contracts/admin';
import { sortedIds } from '#/shared/service/ids';
import type { PageKind } from '#/features/branding/service/values';

export interface MessageEntry {
  key: string;
  // The English text, as the catalogue holds it.
  text: string;
  // Where the message is shown when that is not a page: set for mail.
  group?: string;
}

export const MAIL_GROUP_LABEL = 'Mail';

// The most messages a list of them draws at once; typing narrows it.
export const KEY_LIST_LIMIT = 50;

export const INSERT_LABEL = 'Insert a message';

export const INSERT_NOTE = `Puts a reference to the message you choose where the caret is. The list shows at most ${String(KEY_LIST_LIMIT)} messages: type part of a key or of its text to narrow it.`;

export const KEY_LOADING = 'Loading the list of messages.';

export const KEY_FAILED = 'The list of messages could not be loaded.';

// The messages the template of a kind may name: those of the section that
// fills the kind.
export function messagesForKind(
  catalogue: MessageCatalogueResponse,
  kind: PageKind,
): MessageEntry[] {
  const section = catalogue.sections.find((entry) => entry.kinds.includes(kind));
  return section === undefined ? [] : section.messages.map(({ key, en }) => ({ key, text: en }));
}

// The messages an override may be set under: every key of every section once,
// in key order, a key two sections share showing the first one's text.
export function allMessages(catalogue: MessageCatalogueResponse): MessageEntry[] {
  const byKey = new Map<string, MessageEntry>();
  for (const section of catalogue.sections) {
    // A section filling no page kind is the mail messages.
    const group = section.kinds.length === 0 ? { group: MAIL_GROUP_LABEL } : {};
    for (const { key, en } of section.messages) {
      if (!byKey.has(key)) byKey.set(key, { key, text: en, ...group });
    }
  }
  return sortedIds([...byKey.keys()]).flatMap((key) => byKey.get(key) ?? []);
}

// How a template names a message.
export function templateReference(key: string): string {
  return `{{t "${key}"}}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export function messageOptions(
  entries: readonly MessageEntry[],
): { id: string; label: string; detail: string }[] {
  return entries.map((entry) => ({
    id: entry.key,
    label: entry.key,
    detail:
      entry.group === undefined ? oneLine(entry.text) : `${entry.group}: ${oneLine(entry.text)}`,
  }));
}

// The messages to offer: those a template of `kind` may name, or with no kind
// every message an override may be set under.
export function messagesOf(
  catalogue: MessageCatalogueResponse,
  kind: PageKind | null,
): MessageEntry[] {
  return kind === null ? allMessages(catalogue) : messagesForKind(catalogue, kind);
}
