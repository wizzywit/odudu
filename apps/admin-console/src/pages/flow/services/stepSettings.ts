import { flowStepSettingsSchema } from '@odudu/contracts/admin';
import {
  authenticatorChoiceLabel,
  authenticatorOptions,
} from '#/shared/lib/services/authenticatorChoices';
import type { FlowStepSettings } from '#/pages/flow/types/executions';
import type { Step } from '#/pages/flow/services/steps';

export type SettingKey = keyof FlowStepSettings;
type Choice = string | number;

interface ControlSpec {
  key: SettingKey;
  // The tenant setting a key left out takes the value of.
  tenantSetting: string;
  label: string;
}

export interface SettingControl {
  key: SettingKey;
  label: string;
  // The first, with an empty id, is the tenant's own value.
  options: { id: string; label: string }[];
  value: string;
}

const NUMERIC: ReadonlySet<SettingKey> = new Set(['digits', 'period', 'count']);

const SPECS: Readonly<Record<string, readonly ControlSpec[]>> = {
  otp: [
    {
      key: 'algorithm',
      tenantSetting: 'totp_algorithm',
      label: 'Algorithm',
    },
    {
      key: 'digits',
      tenantSetting: 'totp_digits',
      label: 'Code length',
    },
    {
      key: 'period',
      tenantSetting: 'totp_period',
      label: 'Code period',
    },
  ],
  passkey: [
    {
      key: 'user_verification',
      tenantSetting: 'webauthn_user_verification',
      label: 'User verification',
    },
    {
      key: 'resident_key',
      tenantSetting: 'webauthn_resident_key',
      label: 'Stored on the device',
    },
  ],
  'recovery-code': [
    {
      key: 'count',
      tenantSetting: 'recovery_code_count',
      label: 'Codes in a set',
    },
  ],
};

function tenantChoice(
  tenant: Readonly<Record<string, unknown>> | undefined,
  setting: string,
): Choice | undefined {
  const value = tenant?.[setting];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function inheritedLabel(spec: ControlSpec, tenant: Readonly<Record<string, unknown>> | undefined) {
  const held = tenantChoice(tenant, spec.tenantSetting);
  return held === undefined
    ? 'Tenant setting'
    : `Tenant setting (${authenticatorChoiceLabel(spec.tenantSetting, held)})`;
}

// The controls a step has, each starting at what the tenant's own setting is.
export function settingControls(
  step: Step,
  tenant: Readonly<Record<string, unknown>> | undefined,
): SettingControl[] {
  return (Object.hasOwn(SPECS, step.authenticator) ? (SPECS[step.authenticator] ?? []) : []).map(
    (spec) => {
      const named = step.settings?.[spec.key];
      return {
        key: spec.key,
        label: `${spec.label} for ${step.authenticator}`,
        options: [
          { id: '', label: inheritedLabel(spec, tenant) },
          ...authenticatorOptions(spec.tenantSetting),
        ],
        value: named === undefined ? '' : String(named),
      };
    },
  );
}

function settingsWith(
  settings: FlowStepSettings | undefined,
  key: SettingKey,
  raw: string,
): FlowStepSettings | null | undefined {
  const rest = Object.fromEntries(
    Object.entries(settings ?? {}).filter(([named]) => named !== key),
  );
  const next = raw === '' ? rest : { ...rest, [key]: NUMERIC.has(key) ? Number(raw) : raw };
  const parsed = flowStepSettingsSchema.safeParse(next);
  if (!parsed.success) return undefined;
  return Object.keys(parsed.data).length === 0 ? null : parsed.data;
}

// One key of one step, set to a value or, empty, back to the tenant's own.
// A step left naming nothing carries no `settings`; a value the contract does
// not take leaves the list as it was.
export function withSetting(
  steps: readonly Step[],
  authenticator: string,
  key: SettingKey,
  raw: string,
): Step[] {
  return steps.map((step) => {
    if (step.authenticator !== authenticator) return step;
    const next = settingsWith(step.settings, key, raw);
    if (next === undefined) return step;
    const bare = { authenticator: step.authenticator, requirement: step.requirement };
    return next === null ? bare : { ...bare, settings: next };
  });
}
