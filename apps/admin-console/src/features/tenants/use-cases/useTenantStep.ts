import { useTenantCreate } from '#/features/tenants/repository/useCreation';
import { administratorOf, type Creation } from '#/features/tenants/services/creation';
import { issuerPreview, nameProblem } from '#/features/tenants/services/name';
import {
  createTenantCall,
  findTenantCall,
  tenantNotCreatedText,
} from '#/features/tenants/services/steps';
import type { StepFeedback } from '#/features/tenants/use-cases/useStepFeedback';
import { TENANT_NAME_RULE_TEXT } from '#/shared/services/labels';

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

// The step that creates the tenant.
export function useTenantStep(
  creation: Extract<Creation, { step: 'tenant' }>,
  feedback: StepFeedback,
  update: (creation: Creation) => void,
  systemIssuer: string | undefined,
): TenantStep {
  const tenantCreate = useTenantCreate();
  const { name, displayName } = creation;
  const { errors, setErrors, setMessage, setUnconfirmed, setChecking, move, refused } = feedback;
  const created = (tenant: string): void => {
    move(administratorOf(tenant, 'created'));
  };
  return {
    step: 'tenant',
    name,
    displayName,
    rule: TENANT_NAME_RULE_TEXT,
    issuer: issuerPreview(systemIssuer, name),
    nameError: errors.name,
    displayNameError: errors.display_name,
    message: feedback.message,
    unconfirmed: feedback.unconfirmed,
    busy: tenantCreate.busy || feedback.checking,
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
  };
}
