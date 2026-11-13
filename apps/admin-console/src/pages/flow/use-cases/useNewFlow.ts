import { useState } from 'react';
import type { Area } from '#/entities/area';
import { useRefusal } from '#/entities/session';
import { useCreateFlow, useFlowsRecord } from '#/pages/flow/repository/useFlows';
import { flowArea } from '#/pages/flow/services/flowWording';
import {
  creationOf,
  createSpec,
  flowHref,
  flowTrail,
  flowsHref,
} from '#/pages/flow/services/flows';
import { FLOWS_WORDS, type FlowsWords } from '#/pages/flow/services/flowsWords';
import { useGo } from '#/shared/lib/repository/useGo';
import { useToast } from '#/shared/lib/repository/useToasts';
import type { Crumb } from '#/shared/lib/services/breadcrumb';
import { createdText, lookupText } from '#/shared/lib/services/failure';
import { useCreationFlow } from '#/shared/lib/use-cases/useCreationFlow';

export interface NewFlow {
  words: FlowsWords['create'];
  listHref: string;
  name: string;
  error: string | undefined;
  message: string | null;
  // The POST's answer was lost: offer to look for the flow rather than send it again.
  unconfirmed: boolean;
  busy: boolean;
  editName: (name: string) => void;
  submit: () => void;
  check: () => void;
}

export function useNewFlow(tenant: string): NewFlow {
  const refusal = useRefusal(tenant);
  const creation = useCreateFlow(tenant);
  const flows = useFlowsRecord(tenant);
  const go = useGo();
  const toast = useToast();
  const [name, setName] = useState('');
  const flow = useCreationFlow<'name'>(refusal);
  const made = (created: { id: string; name: string }): void => {
    toast.succeeded(createdText(created.name));
    go(flowHref(tenant, created.id), { replace: true });
  };
  return {
    words: FLOWS_WORDS.create,
    listHref: flowsHref(tenant),
    name,
    error: flow.errors.name,
    message: flow.message,
    unconfirmed: flow.unconfirmed,
    busy: creation.busy || flows.data === undefined,
    editName: (next) => {
      setName(next);
      flow.edited('name');
    },
    submit: () => {
      const request = creationOf(name, flows.data?.items);
      flow.submit({
        blocked: creation.busy || flows.data === undefined,
        problem: request.problem,
        spec: createSpec(name),
        create: () => creation.create(request.send),
        made,
      });
    },
    check: () => {
      flow.check({
        busy: creation.busy,
        find: () => creation.find(name.trim()),
        made,
        looked: lookupText('flow', name.trim()),
      });
    },
  };
}

// The gate wraps the page, so it takes the area, the title and the way back here.
export function useNewFlowArea(tenant: string): {
  area: Area;
  title: string;
  description: string;
  trail: readonly Crumb[];
} {
  const { area } = flowArea();
  const { title, description } = FLOWS_WORDS.create;
  return { area, title, description, trail: flowTrail(tenant, title) };
}
