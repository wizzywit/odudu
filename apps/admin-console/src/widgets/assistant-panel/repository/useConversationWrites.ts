import { saveFile } from '#/shared/api/adapter/files';
import type { GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';
import { assistantConversationListKey } from '#/shared/lib/repository/queryKeys';
import { useGatewayWrite, type Write } from '#/shared/lib/repository/useWrite';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import {
  deleteConversation,
  exportConversation,
  setConversationArchived,
} from '#/widgets/assistant-panel/adapter/conversations';
import {
  exportFileName,
  exportMediaType,
} from '#/widgets/assistant-panel/services/conversationActions';
import type { SetConversationArchivedResponse } from '#/widgets/assistant-panel/types/contracts';
import type { ExportFormat } from '#/widgets/assistant-panel/types/conversations';

export interface ConversationWrites {
  archive: Write<{ id: string; archived: boolean }, GatewayResult<SetConversationArchivedResponse>>;
  remove: Write<string, GatewayResult<undefined>>;
  // Saves the conversation as a file the person keeps; nothing of it stays here.
  save: (id: string, format: ExportFormat) => Promise<GatewayResult<unknown>>;
}

// Hiding, restoring and deleting change what both lists hold, so both are
// read again once the server has answered, whatever it answered.
export function useConversationWrites(tenant: string): ConversationWrites {
  const { gateway } = useTransport();
  const { invalidate } = useInvalidate();
  const refresh = (): void => {
    invalidate(assistantConversationListKey(tenant));
  };
  const archive = useGatewayWrite({
    send: (g, arg: { id: string; archived: boolean }) =>
      setConversationArchived(g, tenant, arg.id, arg.archived),
    onSettled: refresh,
  });
  const remove = useGatewayWrite({
    send: (g, id: string) => deleteConversation(g, tenant, id),
    onSettled: refresh,
  });
  return {
    archive,
    remove,
    save: async (id, format) => {
      const result = await exportConversation(gateway, tenant, id, format);
      if (result.ok) {
        saveFile(
          exportFileName(id, format),
          result.data.text,
          exportMediaType(format, result.data.contentType),
        );
      }
      return result;
    },
  };
}
