import { useMessageCatalogue } from '#/features/branding-editor/repository/useMessageCatalogue';
import { messagesOf } from '#/features/branding-editor/services/catalogue';
import type { MessageEntry } from '#/features/branding-editor/types/messageCatalogue';
import type { PageKind } from '#/features/branding-editor/services/pageKinds';
import { mapRead, type Read } from '#/shared/services/read';

// The messages a template of `kind` may name, or with no kind every message
// an override may be set under.
export function useMessageKeys(tenant: string, kind: PageKind | null): Read<MessageEntry[]> {
  return mapRead(useMessageCatalogue(tenant), (data) => messagesOf(data, kind));
}
