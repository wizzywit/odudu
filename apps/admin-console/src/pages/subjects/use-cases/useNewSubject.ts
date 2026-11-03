import { useState } from 'react';
import { useAuthority, useRefusal } from '#/entities/session';
import { useCreateSubject } from '#/pages/subjects/repository/useCreateSubject';
import { useGo } from '#/shared/lib/repository/useGo';
import { useToast } from '#/shared/lib/repository/useToasts';
import { lookupText } from '#/shared/lib/services/failure';
import { problemAt } from '#/shared/lib/services/fieldErrors';
import { useCreationFlow } from '#/shared/lib/use-cases/useCreationFlow';
import { USERNAME_RULE_TEXT, usernameProblem } from '#/pages/subjects/services/username';
import {
  manageUsersRefusal,
  newSubjectSpec,
  subjectCreatedText,
} from '#/pages/subjects/services/newSubject';
import { subjectHref, subjectsHref } from '#/entities/subject';

export interface NewSubject {
  // Why creating would be refused, named before anything is sent.
  refused: 'manage-users' | null;
  rule: string;
  listHref: string;
  username: string;
  email: string;
  usernameError: string | undefined;
  emailError: string | undefined;
  message: string | null;
  // The POST's answer was lost: offer to look for the subject rather than send it again.
  unconfirmed: boolean;
  busy: boolean;
  editUsername: (username: string) => void;
  editEmail: (email: string) => void;
  submit: () => void;
  check: () => void;
}

type Field = 'username' | 'email';

export function useNewSubject(tenant: string): NewSubject {
  const authority = useAuthority(tenant);
  const refusal = useRefusal(tenant);
  const creation = useCreateSubject(tenant);
  const go = useGo();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const flow = useCreationFlow<Field>(refusal);

  const land = (id: string, name: string): void => {
    toast.succeeded(subjectCreatedText(name));
    go(subjectHref(tenant, id), { replace: true });
  };

  const looked = lookupText('subject', username);

  return {
    refused: manageUsersRefusal(authority),
    rule: USERNAME_RULE_TEXT,
    listHref: subjectsHref(tenant),
    username,
    email,
    usernameError: flow.errors.username,
    emailError: flow.errors.email,
    message: flow.message,
    unconfirmed: flow.unconfirmed,
    busy: creation.busy,
    editUsername: (next) => {
      setUsername(next);
      flow.edited('username');
    },
    editEmail: (next) => {
      setEmail(next);
      flow.edited('email');
    },
    submit: () => {
      flow.submit({
        blocked: creation.busy,
        problem: problemAt('username', usernameProblem(username)),
        spec: newSubjectSpec(username),
        create: () => creation.create({ username, email }),
        made: (subject) => {
          land(subject.id, username);
        },
      });
    },
    check: () => {
      flow.check({
        busy: creation.busy,
        find: () => creation.find(username),
        made: (subject) => {
          land(subject.id, username);
        },
        looked,
      });
    },
  };
}
