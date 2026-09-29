import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useEndOwnSession, useRefusal } from '#/features/session/index.ts';
import { areaAt, areaHref } from '#/features/shell/index.ts';
import { useGo } from '#/features/subjects/repository/useGo.ts';
import {
  saveAccount,
  useSubjectDeletion,
  useSubjectEnabled,
  useUsernamePolicy,
  type AccountValues,
} from '#/features/subjects/repository/useSubjectRecord.ts';
import {
  subjectName,
  subjectRecord,
  subjectsHref,
  USERNAME_RULE_TEXT,
} from '#/features/subjects/service.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

export type UsernameMode =
  // Offered: the tenant's policy accepts a rename.
  | { readonly kind: 'editable'; readonly description: string }
  // Not offered: the policy is off, and this is why.
  | { readonly kind: 'fixed'; readonly reason: string; readonly settingsHref: string }
  | { readonly kind: 'failed'; readonly retry: () => void }
  | { readonly kind: 'checking' };

export interface Confirmable {
  readonly confirming: boolean;
  readonly busy: boolean;
  // The server's refusal, said in the dialog that asked for it.
  readonly problem: string | null;
  readonly ask: () => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

export interface SubjectAccount {
  readonly name: string;
  readonly section: SectionSave<AccountValues>;
  readonly username: UsernameMode;
  readonly enabled: boolean;
  // Enabling has an inverse, so it asks nothing; disabling asks first.
  readonly enable: () => void;
  readonly disable: Confirmable;
  // Why the last enable did not happen, said beside the button.
  readonly enabledMessage: string | null;
  readonly remove: Confirmable;
}

function refusalText(
  name: string,
  verb: string,
  result: Exclude<GatewayResult<unknown>, { ok: true }>,
): string {
  switch (result.kind) {
    case 'network':
      return `Could not confirm whether ${name} was ${verb}. It has not been sent again; look at the subject before trying again.`;
    case 'schema':
      return `${name} may have been ${verb}, but the answer could not be read. Reload to check.`;
    case 'defect':
      return `The console could not finish, so ${name} was not ${verb}. This is a fault in the console, not something you did.`;
    case 'problem':
      if (result.problem.status === 403) {
        return `${name} was not ${verb}: it needs the manage-users capability, or ${name} holds an admin capability you do not.`;
      }
      if (result.problem.status === 412) {
        return `${name} changed elsewhere since you opened it, so it was not ${verb}. It has been read again; look at it before trying again.`;
      }
      return `${name} was not ${verb}: ${result.problem.detail ?? result.problem.title}`;
  }
}

function useUsernameMode(tenant: string): UsernameMode {
  const policy = useUsernamePolicy(tenant);
  switch (policy.status) {
    case 'loading':
      return { kind: 'checking' };
    case 'failed':
      return { kind: 'failed', retry: policy.retry };
    case 'ready':
      return policy.editable
        ? { kind: 'editable', description: USERNAME_RULE_TEXT }
        : {
            kind: 'fixed',
            reason:
              "Usernames in this tenant are fixed: its username_editable setting is off, so a rename would be refused. Turn it on under the tenant's",
            settingsHref: areaHref(tenant, areaAt('settings')),
          };
  }
}

export function useSubjectAccount(
  tenant: string,
  subject: Subject,
  etag: string,
  gone: boolean,
  // Whether this is the subject signed in, whose delete ends the session.
  self: boolean,
): SubjectAccount {
  const refusal = useRefusal(tenant);
  const push = useToasts((queue) => queue.push);
  const go = useGo();
  const name = subjectName(subject);
  const section = useSectionSave({
    tenant,
    record: subjectRecord(subject.id),
    section: 'account',
    label: 'Account',
    etag,
    capability: 'manage-users',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    fields: {
      username: { value: subject.username ?? '', label: 'Username', kind: 'plain' },
      email: { value: subject.email ?? '', label: 'Email', kind: 'plain' },
    },
    save: saveAccount(tenant, subject.id),
  });
  const username = useUsernameMode(tenant);
  const enabledChange = useSubjectEnabled(tenant, subject.id, etag);
  const deletion = useSubjectDeletion(tenant, subject.id);
  const endOwnSession = useEndOwnSession();
  const [confirming, setConfirming] = useState<'disable' | 'delete' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [enabledMessage, setEnabledMessage] = useState<string | null>(null);

  const setEnabled = (next: boolean): void => {
    if (enabledChange.busy) return;
    setProblem(null);
    setEnabledMessage(null);
    const verb = next ? 'enabled' : 'disabled';
    enabledChange
      .run(next)
      .then((result) => {
        if (result.ok) {
          setConfirming(null);
          push({ tone: 'success', message: `${name} is ${verb}.` });
          return;
        }
        refusal.report(result, 'manage-users');
        if (next) setEnabledMessage(refusalText(name, verb, result));
        else setProblem(refusalText(name, verb, result));
      })
      .catch(() => {
        setProblem(refusalText(name, verb, { ok: false, kind: 'defect' }));
      });
  };

  const confirmable = (which: 'disable' | 'delete', confirm: () => void, busy: boolean) => ({
    confirming: confirming === which,
    busy,
    problem: confirming === which ? problem : null,
    ask: () => {
      setProblem(null);
      setConfirming(which);
    },
    cancel: () => {
      setProblem(null);
      setConfirming(null);
    },
    confirm,
  });

  return {
    name,
    section,
    username,
    enabled: subject.enabled,
    enable: () => {
      setEnabled(true);
    },
    disable: confirmable(
      'disable',
      () => {
        setEnabled(false);
      },
      enabledChange.busy,
    ),
    enabledMessage,
    remove: confirmable(
      'delete',
      () => {
        if (deletion.busy) return;
        setProblem(null);
        deletion
          .run()
          .then((result) => {
            if (result.ok && self) {
              endOwnSession().catch(() => undefined);
              return;
            }
            if (result.ok) {
              setConfirming(null);
              push({ tone: 'success', message: `${name} was deleted.` });
              go(subjectsHref(tenant), { replace: true });
              return;
            }
            refusal.report(result, 'manage-users');
            setProblem(refusalText(name, 'deleted', result));
          })
          .catch(() => {
            setProblem(refusalText(name, 'deleted', { ok: false, kind: 'defect' }));
          });
      },
      deletion.busy,
    ),
  };
}
