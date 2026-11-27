import {
  exportCase,
  readActivityPage,
  readReplay,
  reportConversation,
} from '#/pages/assistant-activity/adapter/assistantActivity';
import { caseKey, replayKey } from '#/pages/assistant-activity/repository/queryKeys';
import { saveFile } from '#/shared/api/adapter/files';
import { useTransport } from '#/shared/api/transport/useTransport';
import { listKey } from '#/shared/lib/repository/queryKeys';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useRead } from '#/shared/lib/repository/useRead';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import { useGatewayWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { Read } from '#/shared/lib/services/read';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import type { GatewayResult } from '#/shared/lib/services/result';
import { CASE_MEDIA_TYPE, caseFileName } from '#/pages/assistant-activity/services/exportCase';
import type {
  ActivityConversation,
  Replay,
  Reported,
} from '#/pages/assistant-activity/types/activity';

// Reading a conversation's text is itself recorded, so neither the list nor a
// replay is read again just because the tab regained focus.
export function useActivityList(tenant: string): ResourceListState<ActivityConversation> {
  return useResourceList({
    tenant,
    resource: 'assistant-activity',
    filters: ['person', 'conversation', 'tool', 'outcome', 'kind'],
    refetchOnFocus: false,
    read: (gateway, query) => readActivityPage(gateway, tenant, query),
  });
}

export function useReplay(tenant: string, id: string): Read<Replay> {
  const { gateway } = useTransport();
  return useRead(replayKey(tenant, id), true, () => readReplay(gateway, tenant, id), {
    immutable: true,
  });
}

// A report changes what the list and the replay say of the conversation.
export function useReport(tenant: string, id: string): Write<'report', GatewayResult<Reported>> {
  const { invalidate } = useInvalidate();
  return useGatewayWrite({
    send: (gateway) => reportConversation(gateway, tenant, id),
    onSettled: () => {
      invalidate(listKey(tenant, 'assistant-activity'), replayKey(tenant, id));
    },
  });
}

export interface CaseExport {
  busy: boolean;
  // Saves the test case as the server wrote it, answering the file's name.
  save: () => Promise<GatewayResult<{ fileName: string }>>;
}

// The case is saved as the text the server sent and kept nowhere else.
export function useCaseExport(tenant: string, id: string): CaseExport {
  const { gateway } = useTransport();
  const fresh = useFreshRead();
  return {
    busy: fresh.pending,
    save: async () => {
      const result = await fresh.read(caseKey(tenant, id), () => exportCase(gateway, tenant, id));
      if (!result.ok) return result;
      const fileName = caseFileName(id);
      saveFile(fileName, result.data.text, result.data.contentType ?? CASE_MEDIA_TYPE);
      return { ...result, data: { fileName } };
    },
  };
}
