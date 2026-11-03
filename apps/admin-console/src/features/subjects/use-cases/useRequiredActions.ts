import type { SetRequiredActionsResponse } from '@odudu/contracts/admin';
import { useRefusal } from '#/entities/session';
import {
  saveActions,
  useActionsRecord,
  type ActionValues,
} from '#/features/subjects/repository/useAccess';
import type { RecordState } from '#/shared/repository/useRecord';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { accessRefusal } from '#/shared/services/capabilities';
import { subjectName } from '#/features/subjects/services/subjectName';
import { actionsRecord } from '#/features/subjects/services/subjectRecords';
import {
  describeActions,
  requiredActionsInOrder,
} from '#/features/subjects/services/requiredActions';
import { type Subject } from '#/entities/subject';

export function useRequiredActionsRead(
  tenant: string,
  id: string,
): RecordState<SetRequiredActionsResponse> {
  return useActionsRecord(tenant, id);
}

export interface SubjectActions {
  name: string;
  canManage: boolean;
  save: SectionSave<ActionValues>;
  choose: (actions: readonly string[]) => void;
}

export function useRequiredActions(
  tenant: string,
  subject: Subject,
  data: SetRequiredActionsResponse,
  etag: string,
  gone: boolean,
  canManage: boolean,
): SubjectActions {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const save = useSectionSave({
    tenant,
    record: actionsRecord(subject.id),
    section: 'required-actions',
    label: 'Required actions',
    etag,
    capability: 'manage-users',
    gone,
    refusal,
    explain: accessRefusal(name, 'actions'),
    fields: {
      actions: {
        value: requiredActionsInOrder(data.actions),
        label: 'Required actions',
        kind: 'plain',
        describe: describeActions,
      },
    },
    save: saveActions(tenant, subject.id),
  });
  return {
    name,
    canManage,
    save,
    choose: (value) => {
      save.edit('actions', requiredActionsInOrder(value));
    },
  };
}
