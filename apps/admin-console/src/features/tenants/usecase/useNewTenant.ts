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
  administratorOf,
  enterHref,
  freshCreation,
  issuerPreview,
  NAME_RULE,
  nameProblem,
  SYSTEM_ADMINS_HREF,
  tenantHref,
  type Creation,
  type CreationFlow,
} from '#/features/tenants/service.ts';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  administratorNeeds,
} from '#/shared/service/administrators.ts';
import {
  CAPABILITY_TEXT,
  ceilingOf,
  fullText,
  holdingLabel,
  holdingsIn,
  includedBy,
} from '#/shared/service/capabilities.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

type Step<S extends Creation['step']> = Extract<Creation, { step: S }>;

export interface TenantStep {
  step: 'tenant';
  name: string;
  displayName: string;
  rule: string;
  issuer: string | null;
  nameError: string | undefined;
  displayNameError: string | undefined;
  message: string | null;
  // The POST's answer was lost: offer to look for the tenant rather than send it again.
  unconfirmed: boolean;
  busy: boolean;
  editName: (name: string) => void;
  editDisplayName: (displayName: string) => void;
  submit: () => void;
  check: () => void;
}

export interface AdministratorStep {
  step: 'administrator';
  tenant: string;
  origin: Step<'administrator'>['origin'];
  // system's administrators are the system administrators, managed elsewhere.
  systemAdminsHref: string | null;
  issuer: string | null;
  username: string;
  email: string;
  // Created already, so its username is fixed and only the rest is left.
  created: boolean;
  usernameError: string | undefined;
  emailError: string | undefined;
  message: string | null;
  unconfirmed: boolean;
  busy: boolean;
  // What whoami says is missing for the steps' requests, named before any is sent.
  needs: readonly AdminCapability[];
  // Offered while a further administrator is still to be granted: Full or a
  // set of capabilities. A new tenant's first administrator is given Full.
  choosing: boolean;
  holdings: readonly string[];
  holdingOptions: readonly HoldingOption[];
  holdingsError: string | undefined;
  chooseHoldings: (holdings: readonly string[]) => void;
  secret: string | null;
  editUsername: (username: string) => void;
  editEmail: (email: string) => void;
  submit: () => void;
  check: () => void;
  closeSecret: () => void;
}

export interface HoldingOption {
  id: string;
  label: string;
  description: string;
  note: string | null;
  unavailable: string | null;
}

export interface DoneStep {
  step: 'done';
  tenant: string;
  username: string;
  // What they were given, as a sentence fragment: "tenant-admin".
  holds: string;
  // Starting over from a tenant's own administrator adds another to it.
  again: 'tenant' | 'administrator';
  systemAdminsHref: string | null;
  recordHref: string;
  enterHref: string;
}

export interface Unfinished {
  tenant: string;
  username: string;
  // Whether tenant-admin landed, leaving only the one-time password.
  granted: boolean;
}

export interface NewTenant {
  current: TenantStep | AdministratorStep | DoneStep;
  startOver: () => void;
  // A subject created but not finished, which starting over would drop.
  replacing: Unfinished | null;
  replace: () => void;
  keep: () => void;
}

function holdsText(holdings: readonly string[]): string {
  if (holdings.includes('tenant-admin') || holdings.length === 0) return 'tenant-admin';
  if (holdings.length === 1) return String(holdings[0]);
  return `${holdings.slice(0, -1).join(', ')} and ${String(holdings.at(-1))}`;
}

function systemAdminsOf(tenant: string): string | null {
  return tenant === SYSTEM_TENANT ? SYSTEM_ADMINS_HREF : null;
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

// Each page shows its own flow only: creating a tenant, or adding one of
// system's administrators.
export function useNewTenant(flow: CreationFlow): NewTenant {
  const principal = usePrincipal();
  const owner = `${principal.tenant}/${principal.subjectId}`;
  const { creation, update } = useCreationProgress(owner, flow);
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
  const [replacing, setReplacing] = useState<Unfinished | null>(null);

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
      if (Object.keys(placed.fields).length > 0) {
        setErrors(placed.fields);
        setMessage(null);
      } else if (first !== undefined && other !== '') {
        setErrors({ [first]: other });
        setMessage(null);
      } else {
        setErrors({});
        setMessage(other === '' ? failureMessage(what, failure, needed) : other);
      }
      return;
    }
    setMessage(failureMessage(what, failure, needed));
  };

  const replace = (): void => {
    setReplacing(null);
    move(freshCreation(flow));
  };
  const restart = {
    startOver: (): void => {
      if (creation.step === 'administrator' && creation.subjectId !== null) {
        setReplacing({
          tenant: creation.tenant,
          username: creation.username,
          granted: creation.granted,
        });
      } else replace();
    },
    replacing,
    replace,
    keep: (): void => {
      setReplacing(null);
    },
  };

  if (creation.step === 'tenant') {
    const { name, displayName } = creation;
    const created = (tenant: string): void => {
      move(administratorOf(tenant, 'created'));
    };
    return {
      ...restart,
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
      authority === undefined
        ? []
        : administratorNeeds(step.tenant, step).filter((c) => !holds(authority, c));
    const choosing = step.origin === 'existing' && !step.granted;
    const holdingOptions = holdingsIn(step.tenant).map((holding) => {
      const carrier = includedBy(holding, step.holdings);
      return {
        id: holding,
        label: holdingLabel(holding),
        description: holding === 'tenant-admin' ? fullText(step.tenant) : CAPABILITY_TEXT[holding],
        note: carrier === null ? null : `Carried by ${holdingLabel(carrier)}.`,
        unavailable:
          authority === undefined ? null : ceilingOf(step.tenant, holding, authority.capabilities),
      };
    });
    const record = (done: { subjectId: string; granted: boolean }): void => {
      update({ ...step, ...done });
    };
    return {
      ...restart,
      current: {
        step: 'administrator',
        tenant: step.tenant,
        origin: step.origin,
        systemAdminsHref: systemAdminsOf(step.tenant),
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
        choosing,
        holdings: step.holdings,
        holdingOptions,
        holdingsError: errors.holdings,
        chooseHoldings: (next) => {
          if (!choosing) return;
          setErrors((was) =>
            Object.fromEntries(Object.entries(was).filter(([field]) => field !== 'holdings')),
          );
          update({ ...step, holdings: holdingsIn(step.tenant).filter((h) => next.includes(h)) });
        },
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
          if (step.holdings.length === 0) {
            setErrors({ holdings: 'Choose Full, or at least one capability.' });
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
          move({
            step: 'done',
            tenant: step.tenant,
            username: step.username,
            holdings: step.holdings,
          });
        },
      },
    };
  }

  return {
    ...restart,
    current: {
      step: 'done',
      tenant: creation.tenant,
      username: creation.username,
      holds: holdsText(creation.holdings ?? ['tenant-admin']),
      again: flow === 'tenant' ? 'tenant' : 'administrator',
      systemAdminsHref: systemAdminsOf(creation.tenant),
      recordHref: tenantHref(creation.tenant),
      enterHref: enterHref(creation.tenant),
    },
  };
}
