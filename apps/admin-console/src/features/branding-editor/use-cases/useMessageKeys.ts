import { useMessageCatalogue } from '#/features/branding-editor/repository/useMessageCatalogue';
import {
  messageKeys,
  messagesOf,
  type MessageKeys,
} from '#/features/branding-editor/services/catalogue';
import type { PageKind } from '#/features/branding-editor/services/pageKinds';
import { mapRead } from '#/shared/services/read';

// The messages a template of `kind` may name, or with no kind every message
// an override may be set under, with the words a picker of them says.
export function useMessageKeys(tenant: string, kind: PageKind | null): MessageKeys {
  return messageKeys(mapRead(useMessageCatalogue(tenant), (data) => messagesOf(data, kind)));
}
