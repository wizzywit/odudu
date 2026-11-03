import type { ReactNode } from 'react';
import { useRecordActivity } from '#/features/record-activity/use-cases/useRecordActivity';
import { ActivityTab } from '#/features/record-activity/ui/ActivityTab';
import { CapabilityNote } from '#/shared/ui/CapabilityNote';
import { recordTab } from '#/shared/ui/RecordTab';

type Resource = 'client' | 'group' | 'role' | 'scope' | 'subject';

// A record's Activity tab: what the trail holds, and the trail itself.
export function RecordActivity({
  resource,
  tenant,
  id,
  lead,
  readable,
}: {
  // The audit log's name for the record, and what the empty trail calls it.
  resource: Resource;
  tenant: string;
  id: string;
  lead: ReactNode;
  // False where the audit would refuse the read: nothing is asked of it.
  readable: boolean;
}) {
  const { list, words } = useRecordActivity(resource, tenant, id, readable);
  return (
    <div className={recordTab.tab}>
      <p className={recordTab.rule}>{lead}</p>
      {readable ? (
        <ActivityTab list={list} words={words} />
      ) : (
        <CapabilityNote capability="view-audit">{words.refusedNoun}</CapabilityNote>
      )}
    </div>
  );
}
