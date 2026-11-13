import {
  flowStepSettingsSchema,
  RECOVERY_CODE_COUNT_RANGE,
  TOTP_ALGORITHM_CHOICES,
  TOTP_DIGITS_CHOICES,
  TOTP_PERIOD_CHOICES,
  WEBAUTHN_REQUIREMENT_CHOICES,
} from '@odudu/contracts/admin';
import type { FlowStepSettings } from '#/pages/flow/types/executions';
import type { Step } from '#/pages/flow/services/steps';

export type SettingKey = keyof FlowStepSettings;
type Choice = string | number;

interface ControlSpec {
  key: SettingKey;
  // The tenant setting a key left out takes the value of.
  tenantSetting: string;
  label: string;
  choices: readonly Choice[];
  say: (choice: Choice) => string;
}

export interface SettingControl {
  key: SettingKey;
  label: string;
  // The first, with an empty id, is the tenant's own value.
  options: { id: string; label: string }[];
  value: string;
}

const NUMERIC: ReadonlySet<SettingKey> = new Set(['digits', 'period', 'count']);

function capitalised(choice: Choice): string {
  const text = String(choice);
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

const REQUIREMENT_SAYS = capitalised;

const COUNTS = Array.from(
  { length: RECOVERY_CODE_COUNT_RANGE.max - RECOVERY_CODE_COUNT_RANGE.min + 1 },
  (_, at) => RECOVERY_CODE_COUNT_RANGE.min + at,
);

const SPECS: Readonly<Record<string, readonly ControlSpec[]>> = {
  otp: [
    {
      key: 'algorithm',
      tenantSetting: 'totp_algorithm',
      label: 'Algorithm',
      choices: TOTP_ALGORITHM_CHOICES,
      say: String,
    },
    {
      key: 'digits',
      tenantSetting: 'totp_digits',
      label: 'Code length',
      choices: TOTP_DIGITS_CHOICES,
      say: (choice) => `${String(choice)} digits`,
    },
    {
      key: 'period',
      tenantSetting: 'totp_period',
      label: 'Code period',
      choices: TOTP_PERIOD_CHOICES,
      say: (choice) => `${String(choice)} seconds`,
    },
  ],
  passkey: [
    {
      key: 'user_verification',
      tenantSetting: 'webauthn_user_verification',
      label: 'User verification',
      choices: WEBAUTHN_REQUIREMENT_CHOICES,
      say: REQUIREMENT_SAYS,
    },
    {
      key: 'resident_key',
      tenantSetting: 'webauthn_resident_key',
      label: 'Stored on the device',
      choices: WEBAUTHN_REQUIREMENT_CHOICES,
      say: REQUIREMENT_SAYS,
    },
  ],
  'recovery-code': [
    {
      key: 'count',
      tenantSetting: 'recovery_code_count',
      label: 'Codes in a set',
      choices: COUNTS,
      say: (choice) => `${String(choice)} codes`,
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
  return held === undefined ? 'Tenant setting' : `Tenant setting (${spec.say(held)})`;
}

// The controls a step has, each starting at what the tenant's own setting is.
export function settingControls(
  step: Step,
  tenant: Readonly<Record<string, unknown>> | undefined,
): SettingControl[] {
  return (SPECS[step.authenticator] ?? []).map((spec) => {
    const named = step.settings?.[spec.key];
    return {
      key: spec.key,
      label: `${spec.label} for ${step.authenticator}`,
      options: [
        { id: '', label: inheritedLabel(spec, tenant) },
        ...spec.choices.map((choice) => ({ id: String(choice), label: spec.say(choice) })),
      ],
      value: named === undefined ? '' : String(named),
    };
  });
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

export function settingsSummary(settings: FlowStepSettings | undefined): string {
  return Object.entries(settings ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(', ');
}
