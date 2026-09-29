import { useState } from 'react';
import { useAuthority, usePrincipal, useRefusal } from '#/features/session/index.ts';
import { holds } from '#/features/shell/index.ts';
import {
  useCreationProgress,
  useFindSubject,
  useFirstAdministrator,
  useTenantCreate,
} from '#/features/tenants/repository/useCreation.ts';
import { useSystemIssuer } from '#/features/tenants/repository/useSystemIssuer.ts';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  administratorNeeds,
  administratorOf,
  enterHref,
  FRESH_CREATION,
  issuerPreview,
  NAME_RULE,
  nameProblem,
  tenantHref,
  type Creation,
} from '#/features/tenants/service.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

type Step<S extends Creation['step']> = Extract<Creation, { step: S }>;

export interface TenantStep {
  readonly step: 'tenant';
  readonly name: string;
  readonly displayName: string;
  readonly rule: string;
  readonly issuer: string | null;
  readonly nameError: string | undefined;
  readonly displayNameError: string | undefined;
  readonly message: string | null;
  // The POST's answer was lost: offer to look for the tenant rather than send it again.
  readonly unconfirmed: boolean;
  readonly busy: boolean;
  readonly editName: (name: string) => void;
  readonly editDisplayName: (displayName: string) => void;
  readonly submit: () => void;
  readonly check: () => void;
}

export interface AdministratorStep {
  readonly step: 'administrator';
  readonly tenant: string;
  readonly origin: Step<'administrator'>['origin'];
  readonly issuer: string | null;
  readonly username: string;
  readonly email: string;
  // Created already, so its username is fixed and only the rest is left.
  readonly created: boolean;
  readonly usernameError: string | undefined;
  readonly emailError: string | undefined;
  readonly message: string | null;
  readonly unconfirmed: boolean;
  readonly busy: boolean;
  // What whoami says is missing for the steps' requests, named before any is sent.
  readonly needs: readonly AdminCapability[];
  readonly secret: string | null;
  readonly editUsername: (username: string) => void;
  readonly editEmail: (email: string) => void;
  readonly submit: () => void;
  readonly check: () => void;
  readonly closeSecret: () => void;
}

export interface DoneStep {
  readonly step: 'done';
  readonly tenant: string;
  readonly username: string;
  readonly recordHref: string;
  readonly enterHref: string;
}

export interface NewTenant {
  readonly current: TenantStep | AdministratorStep | DoneStep;
  readonly startOver: () => void;
}

function failureMessage(what: string, failure: GatewayFailure, needed: AdminCapability): string {
  switch (failure.kind) {
    case 'network':
      return `Could not confirm that ${what}. Nothing was sent again; check before trying again.`;
    case 'schema':
      return `${what} may have happened, but the answer could not be read. Check before trying again.`;
    case 'defect':
      return `The console could not finish: ${what} did not happen. This is a fault in the console, not something you did.`;
    case 'problem':
      if (failure.problem.status === 403) return `Refused: ${what} needs the ${needed} capability.`;
      return failure.problem.detail ?? failure.problem.title;
  }
}

export function useNewTenant(): NewTenant {
  const principal = usePrincipal();
  const owner = `${principal.tenant}/${principal.subjectId}`;
  const { creation, update } = useCreationProgress(owner);
  const systemIssuer = useSystemIssuer();
  const tenantCreate = useTenantCreate();
  const administrator = useFirstAdministrator();
  const findSubject = useFindSubject();
  const refusal = useRefusal(SYSTEM_TENANT);
  const authority = useAuthority(SYSTEM_TENANT);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [checking, setChecking] = useState(false);

  const move = (next: Creation): void => {
    setErrors({});
    setMessage(null);
    setUnconfirmed(false);
    update(next);
  };

  const refused = (
    what: string,
    failure: GatewayFailure,
    fields: readonly string[],
    needed: AdminCapability,
  ): void => {
    refusal.report(failure, needed);
    setUnconfirmed(failure.kind === 'network');
    if (
      failure.kind === 'problem' &&
      (failure.problem.status === 400 || failure.problem.status === 409)
    ) {
      const placed = fieldErrorsOf(failure.problem, fields);
      const [first] = fields;
      const other = placed.other.join(' ');
      setErrors(
        Object.keys(placed.fields).length === 0 && first !== undefined && other !== ''
          ? { [first]: other }
          : placed.fields,
      );
      setMessage(null);
      return;
    }
    setMessage(failureMessage(what, failure, needed));
  };

  const startOver = (): void => {
    move(FRESH_CREATION);
  };

  if (creation.step === 'tenant') {
    const { name, displayName } = creation;
    const created = (tenant: string): void => {
      move(administratorOf(tenant, 'created'));
    };
    return {
      startOver,
      current: {
        step: 'tenant',
        name,
        displayName,
        rule: NAME_RULE,
        issuer: issuerPreview(systemIssuer, name),
        nameError: errors.name,
        displayNameError: errors.display_name,
        message,
        unconfirmed,
        busy: tenantCreate.busy || checking,
        editName: (next) => {
          update({ ...creation, name: next.trim() });
        },
        editDisplayName: (next) => {
          update({ ...creation, displayName: next });
        },
        submit: () => {
          const problem = nameProblem(name);
          if (problem !== null) {
            setErrors({ name: problem });
            return;
          }
          setErrors({});
          setMessage(null);
          tenantCreate
            .create({ name, displayName })
            .then((result) => {
              if (result.ok) created(result.data.name);
              else
                refused(`${name} was created`, result, ['name', 'display_name'], 'manage-tenants');
            })
            .catch(() => {
              refused(`${name} was created`, { ok: false, kind: 'defect' }, [], 'manage-tenants');
            });
        },
        check: () => {
          setChecking(true);
          tenantCreate
            .find(name)
            .then((result) => {
              if (!result.ok) refused(`${name} exists`, result, [], 'manage-tenants');
              else if (result.data === null) {
                setUnconfirmed(false);
                setMessage(`${name} was not created. Create it again.`);
              } else created(result.data.name);
            })
            .catch(() => undefined)
            .finally(() => {
              setChecking(false);
            });
        },
      },
    };
  }

  if (creation.step === 'administrator') {
    const step = creation;
    const needs =
      authority === undefined ? [] : administratorNeeds(step).filter((c) => !holds(authority, c));
    const record = (done: { readonly subjectId: string; readonly granted: boolean }): void => {
      update({ ...step, ...done });
    };
    return {
      startOver,
      current: {
        step: 'administrator',
        tenant: step.tenant,
        origin: step.origin,
        issuer: issuerPreview(systemIssuer, step.tenant),
        username: step.username,
        email: step.email,
        created: step.subjectId !== null,
        usernameError: errors.username,
        emailError: errors.email,
        message,
        unconfirmed,
        busy: administrator.busy || checking,
        needs,
        secret: administrator.secret,
        editUsername: (next) => {
          if (step.subjectId === null) update({ ...step, username: next.trim() });
        },
        editEmail: (next) => {
          if (step.subjectId === null) update({ ...step, email: next.trim() });
        },
        submit: () => {
          if (needs.length > 0) return;
          if (step.username === '') {
            setErrors({ username: 'Enter a username for the administrator.' });
            return;
          }
          setErrors({});
          setMessage(null);
          setUnconfirmed(false);
          administrator.start({
            ...step,
            onProgress: record,
            onFailure: (failure, call, request) => {
              const needed = ADMINISTRATOR_REQUEST_NEEDS[request];
              if (failure.kind === 'network' && call === 'create') {
                refused(`${step.username} was created`, failure, [], needed);
                return;
              }
              if (failure.kind === 'network') {
                setMessage(
                  `Could not confirm the last step for ${step.username}. Continuing again is safe: it repeats only what did not land.`,
                );
                return;
              }
              refused(
                call === 'create' ? `creating ${step.username}` : `finishing ${step.username}`,
                failure,
                call === 'create' ? ['username', 'email'] : [],
                needed,
              );
            },
          });
        },
        check: () => {
          setChecking(true);
          findSubject(step.tenant, step.username)
            .then((result) => {
              if (!result.ok) {
                refused(
                  `looking for ${step.username}`,
                  result,
                  [],
                  ADMINISTRATOR_REQUEST_NEEDS.find,
                );
              } else if (result.data === null) {
                setUnconfirmed(false);
                setMessage(`${step.username} was not created. Create the administrator again.`);
              } else {
                setUnconfirmed(false);
                setMessage(`${step.username} was created. Continue to finish.`);
                record({ subjectId: result.data.id, granted: false });
              }
            })
            .catch(() => undefined)
            .finally(() => {
              setChecking(false);
            });
        },
        closeSecret: () => {
          administrator.close();
          move({ step: 'done', tenant: step.tenant, username: step.username });
        },
      },
    };
  }

  return {
    startOver,
    current: {
      step: 'done',
      tenant: creation.tenant,
      username: creation.username,
      recordHref: tenantHref(creation.tenant),
      enterHref: enterHref(creation.tenant),
    },
  };
}
