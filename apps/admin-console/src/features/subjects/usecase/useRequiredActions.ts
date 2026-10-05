import type { RequiredAction, SetRequiredActionsResponse, Subject } from '@odudu/contracts/admin';
import { useAuthority, useRefusal } from '#/features/session/index.ts';
import {
  saveActions,
  useActionsRecord,
  type ActionValues,
} from '#/features/subjects/repository/useAccess.ts';
import {
  accessRefusal,
  actionsRecord,
  REQUIRED_ACTIONS,
  subjectName,
} from '#/features/subjects/service.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { lacking } from '#/shared/service/access.ts';

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

function inOrder(actions: readonly string[]): RequiredAction[] {
  return REQUIRED_ACTIONS.map((each) => each.action).filter((action) => actions.includes(action));
}

function describe(value: unknown): string {
  const actions = Array.isArray(value) ? value.map(String) : [];
  const labels = REQUIRED_ACTIONS.filter((each) => actions.includes(each.action)).map(
    (each) => each.label,
  );
  return labels.length === 0 ? 'none' : labels.join(', ');
}

export function useRequiredActions(
  tenant: string,
  subject: Subject,
  data: SetRequiredActionsResponse,
  etag: string,
  gone: boolean,
): SubjectActions {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const canManage = lacking(useAuthority(tenant), ['manage-users']).length === 0;
  const save = useSectionSave({
    tenant,
    record: actionsRecord(subject.id),
    section: 'required-actions',
    label: 'Required actions',
    etag,
    capability: 'manage-users',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    explain: accessRefusal(name, 'actions'),
    fields: {
      actions: { value: inOrder(data.actions), label: 'Required actions', kind: 'plain', describe },
    },
    save: saveActions(tenant, subject.id),
  });
  return {
    name,
    canManage,
    save,
    choose: (value) => {
      save.edit('actions', inOrder(value));
    },
  };
}
