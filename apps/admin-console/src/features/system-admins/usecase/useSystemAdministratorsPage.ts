import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import {
  useAuthority,
  usePrincipal,
  useRefusal,
  useRereadAuthority,
} from '#/features/session/index.ts';
import { areaAt, areaHref, holds } from '#/features/shell/index.ts';
import { useAdministratorChange } from '#/features/system-admins/repository/useAdministratorChange.ts';
import { useSubjectPicker } from '#/features/system-admins/repository/useSubjectPicker.ts';
import {
  useEnabledHolders,
  useSystemAdministrators,
} from '#/features/system-admins/repository/useSystemAdministrators.ts';
import {
  confirmationText,
  onlyHolderOf,
  onlyHolderReason,
  revokeConsequence,
  subjectName,
} from '#/features/system-admins/service.ts';
import { useBeginAdministrator, type BeginAdministrator } from '#/features/tenants/index.ts';
import type { Refused } from '#/shared/repository/administratorRoles.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  administratorNeeds,
  roleChangeNeeds,
} from '#/shared/service/administrators.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

// Why the revoke in the open dialog did not happen, said in that dialog.
export type RevokeProblem =
  | { readonly kind: 'refused'; readonly text: string }
  // Held only indirectly; the subject's own tabs are where it can be changed.
  | { readonly kind: 'not-direct'; readonly name: string; readonly subjectsHref: string };

export interface RevokeDialog {
  readonly title: string;
  readonly consequence: string;
  readonly typed: string;
  readonly problem: RevokeProblem | null;
}

export interface SystemAdministrators {
  readonly list: ResourceListState<Subject>;
  // The one holder the guard would refuse to lose, and why, said beforehand.
  readonly onlyHolder: { readonly id: string; readonly reason: string } | null;
  readonly createNeeds: readonly AdminCapability[];
  readonly changeNeeds: readonly AdminCapability[];
  readonly begin: BeginAdministrator;
  readonly picker: PickerState<Subject>;
  readonly chosen: Subject | null;
  readonly choose: (id: string | null) => void;
  readonly grant: () => void;
  readonly revoking: RevokeDialog | null;
  readonly startRevoke: (subject: Subject) => void;
  readonly cancelRevoke: () => void;
  readonly confirmRevoke: () => void;
  readonly busy: boolean;
  // Why the last grant did not happen, said beside the Grant button.
  readonly grantMessage: string | null;
  // What a revoke that landed came to, when it is not a plain success.
  readonly revokeNotice: string | null;
}

// A refusal is the server's answer about the one change, so it is said in
// a sentence naming who; anything else says what is not known.
function refusalText(name: string, verb: string, refused: Refused): string {
  const { failure, request } = refused;
  switch (failure.kind) {
    case 'network':
      return `Could not confirm whether ${name} was ${verb}. Check the list before trying again.`;
    case 'schema':
      return `${name} may have been ${verb}, but the answer could not be read. Check the list.`;
    case 'defect':
      return `The console could not finish, so ${name} was not ${verb}. This is a fault in the console, not something you did.`;
    case 'problem': {
      const { problem } = failure;
      const why =
        problem.status === 403
          ? (problem.detail ?? `it needs the ${ADMINISTRATOR_REQUEST_NEEDS[request]} capability`)
          : problem.status === 412
            ? 'their roles changed while this ran. Try again'
            : (problem.detail ?? problem.title);
      return `${name} was not ${verb}: ${why}.`;
    }
  }
}

const SUBJECTS_HREF = areaHref(SYSTEM_TENANT, areaAt('subjects'));

export function useSystemAdministratorsPage(): SystemAdministrators {
  const principal = usePrincipal();
  const authority = useAuthority(SYSTEM_TENANT);
  const refusal = useRefusal(SYSTEM_TENANT);
  const rereadAuthority = useRereadAuthority(SYSTEM_TENANT);
  const list = useSystemAdministrators();
  const enabledHolders = useEnabledHolders();
  const picker = useSubjectPicker();
  const change = useAdministratorChange();
  const begin = useBeginAdministrator(SYSTEM_TENANT, 'existing');
  const toast = useToasts((queue) => queue.push);
  const [chosen, setChosen] = useState<Subject | null>(null);
  const [target, setTarget] = useState<Subject | null>(null);
  const [grantMessage, setGrantMessage] = useState<string | null>(null);
  const [revokeNotice, setRevokeNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<RevokeProblem | null>(null);

  const lacking = (needs: readonly AdminCapability[]): readonly AdminCapability[] =>
    authority === undefined ? [] : needs.filter((capability) => !holds(authority, capability));
  const createNeeds = lacking(
    administratorNeeds(SYSTEM_TENANT, { subjectId: null, granted: false }),
  );
  const changeNeeds = lacking(roleChangeNeeds(SYSTEM_TENANT));
  const only = onlyHolderOf(list.rows, enabledHolders);

  const refused = (name: string, verb: string, outcome: Refused): string => {
    refusal.report(outcome.failure, ADMINISTRATOR_REQUEST_NEEDS[outcome.request]);
    return refusalText(name, verb, outcome);
  };

  return {
    list,
    onlyHolder: only === null ? null : { id: only.id, reason: onlyHolderReason(only) },
    createNeeds,
    changeNeeds,
    begin: {
      ...begin,
      start: () => {
        if (createNeeds.length === 0) begin.start();
      },
    },
    picker,
    chosen,
    choose: (id) => {
      setChosen(id === null ? null : (picker.options.find((option) => option.id === id) ?? null));
    },
    grant: () => {
      if (chosen === null || changeNeeds.length > 0 || change.busy) return;
      const name = subjectName(chosen);
      setGrantMessage(null);
      change
        .grant(chosen.id)
        .then((outcome) => {
          if (outcome !== null) {
            setGrantMessage(refused(name, 'granted tenant-admin', outcome));
            return;
          }
          setChosen(null);
          toast({ tone: 'success', message: `${name} is now a system administrator.` });
        })
        .catch(() => undefined);
    },
    revoking:
      target === null
        ? null
        : {
            title:
              target.id === principal.subjectId
                ? 'Revoke your own system administration?'
                : `Revoke ${subjectName(target)}?`,
            consequence: revokeConsequence(target, target.id === principal.subjectId),
            typed: confirmationText(target),
            problem,
          },
    startRevoke: (subject) => {
      if (changeNeeds.length > 0 || subject.id === only?.id) return;
      setRevokeNotice(null);
      setProblem(null);
      setTarget(subject);
    },
    cancelRevoke: () => {
      setProblem(null);
      setTarget(null);
    },
    confirmRevoke: () => {
      if (target === null || change.busy) return;
      const name = subjectName(target);
      const self = target.id === principal.subjectId;
      setProblem(null);
      change
        .revoke(target)
        .then((outcome) => {
          if (outcome.kind === 'refused') {
            setProblem({ kind: 'refused', text: refused(name, 'revoked', outcome) });
            return;
          }
          if (outcome.kind === 'not-direct') {
            setProblem({ kind: 'not-direct', name, subjectsHref: SUBJECTS_HREF });
            return;
          }
          setTarget(null);
          if (self) rereadAuthority();
          if (outcome.stillHolds === true) {
            setRevokeNotice(
              `tenant-admin and manage-tenants were taken from ${name}, who still holds manage-tenants through a group or a role that nests it. Change that group or role to finish.`,
            );
            return;
          }
          if (outcome.stillHolds === null) {
            setRevokeNotice(
              `tenant-admin and manage-tenants were taken from ${name}. Whether they still hold manage-tenants another way could not be checked: the list shows it.`,
            );
            return;
          }
          toast({ tone: 'success', message: `${name} is no longer a system administrator.` });
        })
        .catch(() => undefined);
    },
    busy: change.busy,
    grantMessage,
    revokeNotice,
  };
}
