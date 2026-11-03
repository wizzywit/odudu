import { useAuthority } from '#/entities/session';
import { useFindSubject, useFirstAdministrator } from '#/features/tenants/repository/useCreation';
import { systemAdminsHrefOf } from '#/features/tenants/services/systemAddress';
import {
  administratorProblem,
  choosesHoldings,
} from '#/features/tenants/services/administratorHoldings';
import type { Creation } from '#/entities/creation-draft';
import { issuerPreview } from '#/features/tenants/services/tenantName';
import {
  administratorFailure,
  administratorLookupText,
  findAdministratorCall,
} from '#/features/tenants/services/creationCall';
import type { StepFeedback } from '#/features/tenants/use-cases/useStepFeedback';
import { lacking } from '#/shared/services/access';
import { administratorNeeds } from '#/shared/services/administrators';
import { holdingOptions, holdingsIn, type HoldingOption } from '#/shared/services/capabilities';
import { withoutField } from '#/shared/services/fieldErrors';
import { inOrderOf } from '#/shared/services/ids';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/services/principal';

export interface AdministratorStep {
  step: 'administrator';
  tenant: string;
  origin: Extract<Creation, { step: 'administrator' }>['origin'];
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

// The step that makes the tenant's administrator.
export function useAdministratorStep(
  creation: Extract<Creation, { step: 'administrator' }>,
  feedback: StepFeedback,
  update: (creation: Creation) => void,
  systemIssuer: string | undefined,
): AdministratorStep {
  const authority = useAuthority(SYSTEM_TENANT);
  const administrator = useFirstAdministrator();
  const findSubject = useFindSubject();
  const step = creation;
  const { errors, setErrors, setMessage, setUnconfirmed, setChecking, move, refused } = feedback;
  const needs = lacking(authority, administratorNeeds(step.tenant, step));
  const choosing = choosesHoldings(step);
  const record = (done: { subjectId: string; granted: boolean }): void => {
    update({ ...step, ...done });
  };
  return {
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
    message: feedback.message,
    unconfirmed: feedback.unconfirmed,
    busy: administrator.busy || feedback.checking,
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
  };
}
