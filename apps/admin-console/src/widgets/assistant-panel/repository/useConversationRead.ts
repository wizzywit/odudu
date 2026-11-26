import { assistantConversationKey } from '#/shared/lib/repository/queryKeys';
import { useRead } from '#/shared/lib/repository/useRead';
import type { Read } from '#/shared/lib/services/read';
import { useTransport } from '#/shared/api/transport/useTransport';
import { loadConversation } from '#/widgets/assistant-panel/adapter/conversations';
import type { AssistantConversation } from '#/widgets/assistant-panel/types/contracts';

// A conversation the person had open before, read as the server holds it each
// time the panel opens on it. `asked` is false while there is none to read.
export function useConversationRead(
  tenant: string,
  id: string | null,
): { read: Read<AssistantConversation>; asked: boolean } {
  const { gateway } = useTransport();
  const read = useRead(
    assistantConversationKey(tenant, id ?? ''),
    id !== null,
    () => loadConversation(gateway, tenant, id ?? ''),
    { fresh: true },
  );
  return { read, asked: id !== null };
}
