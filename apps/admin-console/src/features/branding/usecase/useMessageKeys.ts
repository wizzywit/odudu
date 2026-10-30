import { useMessageCatalogue } from '#/features/branding/repository/useMessageCatalogue';
import { messagesOf, type MessageEntry, type PageKind } from '#/features/branding/service';
import { mapRead, type Read } from '#/shared/service/read';

// The messages a template of `kind` may name, or with no kind every message
// an override may be set under.
export function useMessageKeys(tenant: string, kind: PageKind | null): Read<MessageEntry[]> {
  return mapRead(useMessageCatalogue(tenant), (data) => messagesOf(data, kind));
}
