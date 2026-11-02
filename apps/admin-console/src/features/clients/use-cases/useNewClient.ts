import type { Client } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { useCreateClient } from '#/features/clients/repository/useCreateClient';
import { useGo } from '#/shared/repository/useGo';
import {
  CLIENT_CAPABILITY,
  CLIENT_ID_TAKEN,
  CLIENT_LIST_LIMIT,
  clientHref,
  clientIdProblem,
  clientsHref,
  listCount,
  NEW_CLIENT_FIELDS,
  newClientKind,
  afterCreation,
  asksRedirects,
  secretNote,
  secretName,
  secretTitle,
  type NewClientField,
  type NewClientKind,
} from '#/features/clients/services';
import { useToast } from '#/shared/repository/useToasts';
import { problemAt } from '#/shared/services/fieldErrors';
import { createdText, lookupText } from '#/shared/services/failure';
import { DESCRIPTION_MAX, DESCRIPTION_RULE } from '#/shared/services/labels';
import { useCreationFlow } from '#/shared/use-cases/useCreationFlow';

type Errors = Partial<Record<NewClientField, string>>;

export interface NewClientPage {
  listHref: string;
  descriptionRule: string;
  descriptionLimit: number;
  clientId: string;
  name: string;
  description: string;
  kind: NewClientKind;
  // Whether the form asks for redirect URIs, which a service has no use for.
  asksRedirects: boolean;
  redirectUris: readonly string[];
  redirectCount: string;
  errors: Errors;
  message: string | null;
  // The POST's answer was lost: offer to look for the client rather than send it again.
  unconfirmed: boolean;
  busy: boolean;
  editClientId: (value: string) => void;
  editName: (value: string) => void;
  editDescription: (value: string) => void;
  editKind: (value: string) => void;
  editRedirectUris: (value: readonly string[]) => void;
  submit: () => void;
  check: () => void;
  // The secret of a confidential client, for its dialog and nothing else.
  secret: string | null;
  secretTitle: string;
  secretNote: string;
  closeSecret: () => void;
}

export function useNewClient(tenant: string): NewClientPage {
  const refusal = useRefusal(tenant);
  const go = useGo();
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<NewClientKind>('confidential');
  const [redirectUris, setRedirectUris] = useState<readonly string[]>(['']);
  const flow = useCreationFlow<NewClientField>(refusal);
  // Made, and waiting for its secret to be acknowledged before the page moves on.
  const [made, setMade] = useState<Client | null>(null);

  const land = (client: Client): void => {
    toast.succeeded(createdText(client.name));
    go(clientHref(tenant, client.id), { replace: true });
  };

  const looked = lookupText('client', clientId, 'there');

  const creation = useCreateClient(tenant, {
    created: (client, secret) => {
      if (afterCreation(secret) === 'acknowledge') setMade(client);
      else land(client);
    },
    failed: (failure) => {
      flow.fail(failure, {
        noun: 'client',
        name: clientId,
        fields: NEW_CLIENT_FIELDS,
        taken: { field: 'client_id', fallback: CLIENT_ID_TAKEN },
        capability: CLIENT_CAPABILITY,
      });
    },
  });

  return {
    listHref: clientsHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    clientId,
    name,
    description,
    kind,
    asksRedirects: asksRedirects(kind),
    redirectUris,
    redirectCount: listCount(redirectUris, CLIENT_LIST_LIMIT, 'redirect URIs'),
    errors: flow.errors,
    message: flow.message,
    unconfirmed: flow.unconfirmed,
    busy: creation.busy,
    editClientId: (value) => {
      setClientId(value);
      flow.edited('client_id');
    },
    editName: (value) => {
      setName(value);
      flow.edited('name');
    },
    editDescription: (value) => {
      setDescription(value);
      flow.edited('description');
    },
    editKind: (value) => {
      setKind(newClientKind(value));
    },
    editRedirectUris: (value) => {
      setRedirectUris(value);
      flow.edited('redirect_uris');
    },
    submit: () => {
      if (creation.busy || flow.unconfirmed) return;
      const problem = problemAt('client_id', clientIdProblem(clientId));
      if (problem !== null) {
        flow.invalid(problem);
        return;
      }
      flow.begin();
      creation.create({ clientId, name, description, kind, redirectUris });
    },
    check: () => {
      flow.check({ busy: creation.busy, find: () => creation.find(clientId), made: land, looked });
    },
    secret: creation.secret,
    secretTitle: secretTitle(secretName(made, clientId)),
    secretNote: secretNote(secretName(made, clientId)),
    closeSecret: () => {
      creation.closeSecret();
      if (made !== null) land(made);
    },
  };
}
