import type { Client } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { useGo } from '#/shared/repository/useGo.ts';
import {
  useClientDeletion,
  useClientSaves,
  useRereadClient,
  type ConsentValues,
  type DetailValues,
  type EnabledValues,
  type PageValues,
} from '#/features/clients/repository/useClientRecord.ts';
import {
  ceilingRefused,
  CLIENT_CAPABILITY,
  clientRecord,
  clientRefusal,
  clientsHref,
  deleteConsequence,
  deletedText,
  deleteFixed,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  enabledFixed,
  FIELD,
  SECTION,
} from '#/features/clients/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import { flagText } from '#/shared/service/format.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

export type { SectionSave };

export interface Deletion {
  confirming: boolean;
  consequence: string;
  busy: boolean;
  problem: string | null;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

export interface ClientGeneral {
  details: SectionSave<DetailValues>;
  descriptionRule: string;
  descriptionLimit: number;
  pages: SectionSave<PageValues>;
  availability: SectionSave<EnabledValues>;
  // Why it cannot be disabled, said in place of the toggle.
  enabledFixed: string | null;
  consent: SectionSave<ConsentValues>;
  // Why it cannot be deleted, said in place of the button.
  deleteFixed: string | null;
  deletion: Deletion;
}

export function useClientGeneral({
  tenant,
  client,
  etag,
  gone,
}: {
  tenant: string;
  client: Client;
  etag: string;
  gone: boolean;
}): ClientGeneral {
  const refusal = useRefusal(tenant);
  const saves = useClientSaves(tenant, client.id);
  const reread = useRereadClient(tenant, client.id);
  const removal = useClientDeletion(tenant, client.id);
  const push = useToasts((queue) => queue.push);
  const go = useGo();
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const record = clientRecord(client.id);
  const shared = {
    tenant,
    record,
    etag,
    capability: CLIENT_CAPABILITY,
    gone,
    onRefused: (failure: GatewayFailure) => {
      refusal.report(failure, CLIENT_CAPABILITY);
      if (ceilingRefused(failure)) reread();
    },
    explain: clientRefusal,
  };

  const details = useSectionSave({
    ...shared,
    section: 'details',
    label: SECTION.details,
    fields: {
      name: { value: client.name, label: FIELD.name, kind: 'plain' },
      description: { value: client.description ?? '', label: FIELD.description, kind: 'plain' },
    },
    save: saves.details,
  });
  const pages = useSectionSave({
    ...shared,
    section: 'pages',
    label: SECTION.pages,
    fields: {
      client_uri: { value: client.client_uri ?? '', label: FIELD.homePage, kind: 'plain' },
      policy_uri: { value: client.policy_uri ?? '', label: FIELD.privacyPolicy, kind: 'plain' },
      tos_uri: { value: client.tos_uri ?? '', label: FIELD.termsOfService, kind: 'plain' },
    },
    save: saves.pages,
  });
  const availability = useSectionSave({
    ...shared,
    section: 'availability',
    label: SECTION.availability,
    fields: {
      enabled: {
        value: client.enabled,
        label: FIELD.enabled,
        kind: 'plain',
        describe: (value) => flagText(value, 'on', 'off'),
      },
    },
    save: saves.availability,
  });
  const consent = useSectionSave({
    ...shared,
    section: 'consent',
    label: SECTION.consent,
    fields: {
      consent_required: {
        value: client.consent_required,
        label: FIELD.consentRequired,
        kind: 'plain',
        describe: (value) => flagText(value, 'on', 'off'),
      },
    },
    save: saves.consent,
  });

  const copy = {
    name: client.name,
    verb: 'deleted',
    lookAt: 'the clients',
    refused: clientRefusal,
  };

  return {
    details,
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    pages,
    availability,
    enabledFixed: enabledFixed(client),
    consent,
    deleteFixed: deleteFixed(client),
    deletion: {
      confirming: deleting,
      consequence: deleteConsequence(client.name),
      busy: removal.busy,
      problem,
      ask: () => {
        setProblem(null);
        setDeleting(true);
      },
      cancel: () => {
        setProblem(null);
        setDeleting(false);
      },
      confirm: () => {
        if (removal.busy) return;
        setProblem(null);
        removal
          .run()
          .then((result) => {
            if (result.ok) {
              setDeleting(false);
              push({ tone: 'success', message: deletedText(client.name) });
              go(clientsHref(tenant), { replace: true });
              return;
            }
            refusal.report(result, CLIENT_CAPABILITY);
            if (ceilingRefused(result)) reread();
            setProblem(writeFailureText(result, copy));
          })
          .catch(() => {
            setProblem(writeFailureText({ ok: false, kind: 'defect' }, copy));
          });
      },
    },
  };
}
