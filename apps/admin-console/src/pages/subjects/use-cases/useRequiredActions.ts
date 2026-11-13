import { useRefusal } from '#/entities/session';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { useSectionSave, type SectionSave } from '#/shared/lib/repository/useSectionSave';
import { accessRefusal } from '#/shared/lib/services/capabilities';
import { signsInAsItself } from '#/pages/subjects/services/subjectAccount';
import {
  describeActions,
  REQUIRED_ACTION_OPTIONS,
  requiredActionsInOrder,
  type SetRequiredActionsResponse,
  type Subject,
  saveActions,
  useActionsRecord,
  type ActionValues,
  subjectName,
  actionsRecord,
} from '#/entities/subject';

export function useRequiredActionsRead(
  tenant: string,
  id: string,
): RecordState<SetRequiredActionsResponse> {
  return useActionsRecord(tenant, id);
}

export interface SubjectActions {
  name: string;
  canManage: boolean;
  options: typeof REQUIRED_ACTION_OPTIONS;
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
    options: REQUIRED_ACTION_OPTIONS,
    save,
    choose: (value) => {
      save.edit('actions', requiredActionsInOrder(value));
    },
  };
}

// A service subject signs in as itself, so it is asked for nothing at sign-in.
export function useRequiredActionsTab(subject: Subject): { itself: boolean } {
  return { itself: signsInAsItself(subject) };
}
