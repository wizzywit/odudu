import type { Client } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { useCreateClient } from '#/features/clients/repository/useCreateClient.ts';
import { useGo } from '#/features/clients/repository/useGo.ts';
import {
  CLIENT_CAPABILITY,
  CLIENT_ID_TAKEN,
  CLIENT_LIST_LIMIT,
  clientHref,
  clientIdProblem,
  clientsHref,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  listCount,
  NEW_CLIENT_FIELDS,
  newClientType,
  secretNote,
  secretTitle,
  type NewClientField,
  type NewClientType,
} from '#/features/clients/service';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { withoutField } from '#/shared/service/fieldErrors.ts';
import { createdText, createFailure, lookupText } from '#/shared/service/failure.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

type Errors = Partial<Record<NewClientField, string>>;

export interface NewClientPage {
  listHref: string;
  descriptionRule: string;
  descriptionLimit: number;
  clientId: string;
  name: string;
  description: string;
  type: NewClientType;
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
  editType: (value: string) => void;
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
  const push = useToasts((queue) => queue.push);
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<NewClientType>('confidential');
  const [redirectUris, setRedirectUris] = useState<readonly string[]>(['']);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  // Made, and waiting for its secret to be acknowledged before the page moves on.
  const [made, setMade] = useState<Client | null>(null);

  const land = (client: Client): void => {
    push({ tone: 'success', message: createdText(client.name) });
    go(clientHref(tenant, client.id), { replace: true });
  };

  const looked = lookupText('client', clientId, 'there');

  const creation = useCreateClient(tenant, {
    created: (client, withSecret) => {
      if (withSecret) setMade(client);
      else land(client);
    },
    failed: (failure: GatewayFailure) => {
      const outcome = createFailure(failure, {
        noun: 'client',
        name: clientId,
        fields: NEW_CLIENT_FIELDS,
        taken: { field: 'client_id', fallback: CLIENT_ID_TAKEN },
        capability: CLIENT_CAPABILITY,
      });
      if (outcome.unconfirmed) setUnconfirmed(true);
      if (outcome.report) refusal.report(failure, CLIENT_CAPABILITY);
      setErrors(outcome.errors);
      setMessage(outcome.message);
    },
  });

  const edit = (field: NewClientField): void => {
    setErrors((was) => withoutField(was, field));
  };

  return {
    listHref: clientsHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    clientId,
    name,
    description,
    type,
    redirectUris,
    redirectCount: listCount(redirectUris, CLIENT_LIST_LIMIT, 'redirect URIs'),
    errors,
    message,
    unconfirmed,
    busy: creation.busy,
    editClientId: (value) => {
      setClientId(value);
      edit('client_id');
    },
    editName: (value) => {
      setName(value);
      edit('name');
    },
    editDescription: (value) => {
      setDescription(value);
      edit('description');
    },
    editType: (value) => {
      setType(newClientType(value));
    },
    editRedirectUris: (value) => {
      setRedirectUris(value);
      edit('redirect_uris');
    },
    submit: () => {
      if (creation.busy || unconfirmed) return;
      const required = clientIdProblem(clientId);
      if (required !== null) {
        setErrors({ client_id: required });
        return;
      }
      setErrors({});
      setMessage(null);
      creation.create({ clientId, name, description, type, redirectUris });
    },
    check: () => {
      if (creation.busy) return;
      creation
        .find(clientId)
        .then((result) => {
          if (!result.ok) {
            setMessage(looked.failed);
            return;
          }
          if (result.data !== null) {
            land(result.data);
            return;
          }
          setUnconfirmed(false);
          setMessage(looked.missing);
        })
        .catch(() => {
          setMessage(looked.failed);
        });
    },
    secret: creation.secret,
    secretTitle: secretTitle(made?.name ?? clientId),
    secretNote: secretNote(made?.name ?? clientId),
    closeSecret: () => {
      creation.closeSecret();
      if (made !== null) land(made);
    },
  };
}
