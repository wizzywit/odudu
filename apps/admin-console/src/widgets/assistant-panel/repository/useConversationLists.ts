import { assistantConversationListKey } from '#/shared/lib/repository/queryKeys';
import { useListPages } from '#/shared/lib/repository/useResourceList';
import { listConversations } from '#/widgets/assistant-panel/adapter/conversations';

// The most one page of either list holds; "Load more" asks for the next.
const PAGE = '25';

// The person's open conversations and their archived ones, each a page at a
// time. Nothing is asked while the list is not on screen, and what was read
// is read again when it is shown.
export function useConversationLists(tenant: string, asked: boolean) {
  const open = useListPages({
    key: assistantConversationListKey(tenant, 'open'),
    query: new URLSearchParams({ limit: PAGE }),
    cursor: undefined,
    read: (gateway, query) => listConversations(gateway, tenant, query),
    enabled: asked,
  });
  const archived = useListPages({
    key: assistantConversationListKey(tenant, 'archived'),
    query: new URLSearchParams({ archived: 'true', limit: PAGE }),
    cursor: undefined,
    read: (gateway, query) => listConversations(gateway, tenant, query),
    enabled: asked,
  });
  return { open, archived };
}

export type ConversationLists = ReturnType<typeof useConversationLists>;
