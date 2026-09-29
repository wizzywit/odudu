import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import {
  useAuthority,
  usePrincipal,
  useRefusal,
  useRereadAuthority,
} from '#/features/session/index.ts';
import { holds } from '#/features/shell/index.ts';
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

export interface RevokeDialog {
  readonly title: string;
  readonly consequence: string;
  readonly typed: string;
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
  // What the last grant or revoke came to, when it is not a plain success.
  readonly message: string | null;
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
  const [message, setMessage] = useState<string | null>(null);

  const lacking = (needs: readonly AdminCapability[]): readonly AdminCapability[] =>
    authority === undefined ? [] : needs.filter((capability) => !holds(authority, capability));
  const createNeeds = lacking(
    administratorNeeds(SYSTEM_TENANT, { subjectId: null, granted: false }),
  );
  const changeNeeds = lacking(roleChangeNeeds(SYSTEM_TENANT));
  const only = onlyHolderOf(list.rows, enabledHolders);

  const refused = (name: string, verb: string, outcome: Refused): void => {
    refusal.report(outcome.failure, ADMINISTRATOR_REQUEST_NEEDS[outcome.request]);
    setMessage(refusalText(name, verb, outcome));
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
      setMessage(null);
      change
        .grant(chosen.id)
        .then((outcome) => {
          if (outcome !== null) {
            refused(name, 'granted tenant-admin', outcome);
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
          },
    startRevoke: (subject) => {
      if (changeNeeds.length > 0 || subject.id === only?.id) return;
      setMessage(null);
      setTarget(subject);
    },
    cancelRevoke: () => {
      setTarget(null);
    },
    confirmRevoke: () => {
      if (target === null || change.busy) return;
      const name = subjectName(target);
      const self = target.id === principal.subjectId;
      change
        .revoke(target)
        .then((outcome) => {
          setTarget(null);
          if (outcome.kind === 'refused') {
            refused(name, 'revoked', outcome);
            return;
          }
          if (outcome.kind === 'not-direct') {
            setMessage(
              `Nothing was changed: ${name} holds manage-tenants only through a group or a role that nests it. Change that group or role to revoke it.`,
            );
            return;
          }
          if (self) rereadAuthority();
          if (outcome.stillHolds === true) {
            setMessage(
              `tenant-admin and manage-tenants were taken from ${name}, who still holds manage-tenants through a group or a role that nests it. Change that group or role to finish.`,
            );
            return;
          }
          toast({ tone: 'success', message: `${name} is no longer a system administrator.` });
        })
        .catch(() => undefined);
    },
    busy: change.busy,
    message,
  };
}
