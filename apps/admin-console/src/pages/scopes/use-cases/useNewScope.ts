import { useState } from 'react';
import { useAuthority, useRefusal } from '#/entities/session';
import { useCopySource, useCreateScope } from '#/pages/scopes/repository/useCreateScope';
import { type Scope, scopeHref, scopesHref } from '#/entities/scope';
import {
  sourceDescription,
  createBodyOf,
  type Copying,
  copyingOf,
  copyPlan,
  partialCopy,
  sourceBound,
  sourceRoles,
} from '#/pages/scopes/services/scopeCopy';
import { useGo } from '#/shared/repository/useGo';
import { useToast } from '#/shared/repository/useToasts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch';
import { problemAt, requiredProblem } from '#/shared/services/fieldErrors';
import { createdText, lookupText, namedCreation } from '#/shared/services/failure';
import { DESCRIPTION_RULE } from '#/shared/services/labels';
import { useCreationFlow } from '#/shared/use-cases/useCreationFlow';
import { copiedDescription, copyBlocked, copyBusy, type PartialCopy } from '#/shared/services/copy';

type Field = 'name' | 'description';
type Errors = Partial<Record<Field, string>>;

export type { Copying, PartialCopy };

export interface NewScope {
  listHref: string;
  descriptionRule: string;
  copying: Copying;
  name: string;
  description: string;
  errors: Errors;
  message: string | null;
  // The POST's answer was lost: offer to look for the scope rather than send it again.
  unconfirmed: boolean;
  // A copy made, without some of what it maps or binds.
  partial: PartialCopy | null;
  busy: boolean;
  editName: (name: string) => void;
  editDescription: (description: string) => void;
  submit: () => void;
  check: () => void;
}

export function useNewScope(tenant: string): NewScope {
  const refusal = useRefusal(tenant);
  const creation = useCreateScope(tenant);
  const go = useGo();
  const toast = useToast();
  const { params } = useUrlSearch();
  const source = useCopySource(tenant, params.get('copy'));
  const caller = useAuthority(tenant)?.capabilities;
  const [name, setName] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const flow = useCreationFlow<Field>(refusal);
  const [partial, setPartial] = useState<PartialCopy | null>(null);
  const shown = copiedDescription(description, sourceDescription(source));
  const plan = copyPlan(sourceRoles(source), caller, tenant);
  const mappers = sourceBound(source);
  const looked = lookupText('scope', name);

  const land = (scope: Scope, missed: Parameters<typeof partialCopy>[2]): void => {
    const left = partialCopy(scopeHref(tenant, scope.id), scope, missed);
    if (left !== null) {
      setPartial(left);
      return;
    }
    toast.succeeded(createdText(scope.name));
    go(scopeHref(tenant, scope.id), { replace: true });
  };

  const made = (scope: Scope): void => {
    creation
      .fill(
        scope.id,
        plan.mapped.map((role) => role.id),
        mappers,
      )
      .then((missed) => {
        land(scope, missed);
      })
      .catch(() => {
        land(scope, ['roles', 'mappers']);
      });
  };

  return {
    listHref: scopesHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    copying: copyingOf(source, plan),
    name,
    description: shown,
    errors: flow.errors,
    message: flow.message,
    unconfirmed: flow.unconfirmed,
    partial,
    busy: copyBusy(creation.busy, source.status, caller),
    editName: (next) => {
      setName(next);
      flow.edited('name');
    },
    editDescription: (next) => {
      setDescription(next);
      flow.edited('description');
    },
    submit: () => {
      flow.submit({
        blocked: copyBlocked(creation.busy, partial, source.status, caller),
        problem: problemAt('name', requiredProblem(name, 'Enter a name.')),
        spec: namedCreation('scope', name),
        create: () => creation.create(createBodyOf(name, shown, source)),
        made,
      });
    },
    check: () => {
      flow.check({ busy: creation.busy, find: () => creation.find(name), made, looked });
    },
  };
}
