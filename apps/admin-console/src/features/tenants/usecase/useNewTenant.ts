import { useState } from 'react';
import { draftOwner, useAuthority, usePrincipal, useRefusal } from '#/features/session';
import {
  useCreationProgress,
  useFindSubject,
  useFirstAdministrator,
  useTenantCreate,
} from '#/features/tenants/repository/useCreation.ts';
import { useSystemIssuer } from '#/features/tenants/repository/useSystemIssuer.ts';
import {
  administratorFailure,
  administratorLookupText,
  administratorOf,
  administratorProblem,
  againOf,
  choosesHoldings,
  createTenantCall,
  enterHref,
  findAdministratorCall,
  findTenantCall,
  freshCreation,
  holdsText,
  issuerPreview,
  NAME_RULE,
  nameProblem,
  stepRefusal,
  systemAdminsHrefOf,
  systemHoldsText,
  tenantHref,
  tenantNotCreatedText,
  unfinishedOf,
  type Creation,
  type CreationFlow,
  type StepCall,
  type Unfinished,
} from '#/features/tenants/service.ts';
import { lacking } from '#/shared/service/access.ts';
import { administratorNeeds } from '#/shared/service/administrators.ts';
import { holdingOptions, holdingsIn, type HoldingOption } from '#/shared/service/capabilities.ts';
import { withoutField } from '#/shared/service/fieldErrors.ts';
import { inOrderOf } from '#/shared/service/ids.ts';
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

export interface DoneStep {
  step: 'done';
  tenant: string;
  username: string;
  // What they were given, as a sentence fragment: "tenant-admin".
  holds: string;
  // What a system administrator is said to hold, around "in system".
  systemHolds: string;
  // Starting over from a tenant's own administrator adds another to it.
  again: 'tenant' | 'administrator';
  systemAdminsHref: string | null;
  recordHref: string;
  enterHref: string;
}

export interface NewTenant {
  current: TenantStep | AdministratorStep | DoneStep;
  startOver: () => void;
  // A subject created but not finished, which starting over would drop.
  replacing: Unfinished | null;
  replace: () => void;
  keep: () => void;
}

// Each page shows its own flow only: creating a tenant, or adding one of
// system's administrators.
export function useNewTenant(flow: CreationFlow): NewTenant {
  const principal = usePrincipal();
  const owner = draftOwner(principal);
  const { creation, update } = useCreationProgress(owner, flow);
  const systemIssuer = useSystemIssuer();
  const tenantCreate = useTenantCreate();
  const administrator = useFirstAdministrator();
  const findSubject = useFindSubject();
  const refusal = useRefusal(SYSTEM_TENANT);
  const authority = useAuthority(SYSTEM_TENANT);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
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

  const refused = (call: StepCall, failure: GatewayFailure): void => {
    refusal.report(failure, call.needed);
    const outcome = stepRefusal(failure, call);
    setUnconfirmed(outcome.unconfirmed);
    if (outcome.errors !== null) setErrors(outcome.errors);
    setMessage(outcome.message);
  };

  const replace = (): void => {
    setReplacing(null);
    move(freshCreation(flow));
  };
  const restart = {
    startOver: (): void => {
      const unfinished = unfinishedOf(creation);
      if (unfinished === null) replace();
      else setReplacing(unfinished);
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
              else refused(createTenantCall(name), result);
            })
            .catch(() => {
              refused(createTenantCall(name), { ok: false, kind: 'defect' });
            });
        },
        check: () => {
          setChecking(true);
          tenantCreate
            .find(name)
            .then((result) => {
              if (!result.ok) refused(findTenantCall(name), result);
              else if (result.data === null) {
                setUnconfirmed(false);
                setMessage(tenantNotCreatedText(name));
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
    const needs = lacking(authority, administratorNeeds(step.tenant, step));
    const choosing = choosesHoldings(step);
    const record = (done: { subjectId: string; granted: boolean }): void => {
      update({ ...step, ...done });
    };
    return {
      ...restart,
      current: {
        step: 'administrator',
        tenant: step.tenant,
        origin: step.origin,
        systemAdminsHref: systemAdminsHrefOf(step.tenant),
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
        holdingOptions: holdingOptions(step.tenant, step.holdings, authority?.capabilities),
        holdingsError: errors.holdings,
        chooseHoldings: (next) => {
          if (!choosing) return;
          setErrors((was) => withoutField(was, 'holdings'));
          update({ ...step, holdings: inOrderOf(holdingsIn(step.tenant), next) });
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
          const problem = administratorProblem(step);
          if (problem !== null) {
            setErrors(problem);
            return;
          }
          setErrors({});
          setMessage(null);
          setUnconfirmed(false);
          administrator.start({
            ...step,
            onProgress: record,
            onFailure: (failure, call, request) => {
              const outcome = administratorFailure(failure, call, request, step.username);
              if (outcome.kind === 'lost') setMessage(outcome.message);
              else refused(outcome.call, failure);
            },
          });
        },
        check: () => {
          setChecking(true);
          findSubject(step.tenant, step.username)
            .then((result) => {
              if (!result.ok) {
                refused(findAdministratorCall(step.username), result);
              } else {
                setUnconfirmed(false);
                setMessage(administratorLookupText(step.username, result.data !== null));
                if (result.data !== null) record({ subjectId: result.data.id, granted: false });
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

  const holds = holdsText(creation.holdings);
  return {
    ...restart,
    current: {
      step: 'done',
      tenant: creation.tenant,
      username: creation.username,
      holds,
      systemHolds: systemHoldsText(holds),
      again: againOf(flow),
      systemAdminsHref: systemAdminsHrefOf(creation.tenant),
      recordHref: tenantHref(creation.tenant),
      enterHref: enterHref(creation.tenant),
    },
  };
}
