import { json, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { graceRoutes } from '#/testing/renderConsole';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';
export const FL = `${ACME_ADMIN}/flow/executions`;
export const FLS = `${ACME_ADMIN}/flows`;
export const ST = `${ACME_ADMIN}/settings`;

export const AVAILABLE = ['password', 'passkey', 'otp', 'recovery-code'];

export function step(index: number, authenticator: string, requirement: string) {
  return { index, authenticator, requirement };
}

// What a tenant starts with, less the recovery codes.
export const FLOW_ITEMS = [
  step(0, 'passkey', 'alternative'),
  step(1, 'password', 'alternative'),
  step(2, 'otp', 'conditional'),
];

export function flowBody(items = FLOW_ITEMS) {
  return { items, available: AVAILABLE };
}

export function flowAnswer(items = FLOW_ITEMS, etag = '"f1"'): Answer {
  return json(flowBody(items), 200, { etag });
}

export function flowRecordBody(id: string, name: string, isDefault = false, steps = STEPS) {
  return { id, name, is_default: isDefault, steps };
}

const STEPS = [
  { authenticator: 'passkey', requirement: 'alternative' },
  { authenticator: 'password', requirement: 'alternative' },
  { authenticator: 'otp', requirement: 'conditional' },
];

export const DEFAULT_FLOW_ID = '0192a0a0-0000-7000-8000-0000000000f1';
export const STAFF_FLOW_ID = '0192a0a0-0000-7000-8000-0000000000f2';

// The default flow and one of the tenant's own.
export const FLOW_LIST = [
  flowRecordBody(DEFAULT_FLOW_ID, 'default', true),
  flowRecordBody(STAFF_FLOW_ID, 'staff', false, STEPS.slice(1, 2)),
];

export function flowsAnswer(items = FLOW_LIST, etag = '"l1"'): Answer {
  return json({ items, total: items.length, available: AVAILABLE }, 200, { etag });
}

export function settingsAnswer(otpRequired = false, etag = '"s1"'): Answer {
  return json({ display_name: 'Acme', otp_required: otpRequired }, 200, { etag });
}

// grace of acme holding the capabilities given, with the flow above and otp_required off.
export function flowRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(
    capabilities,
    {
      [`GET ${FL}`]: flowAnswer(),
      [`GET ${FLS}`]: flowsAnswer(),
      [`GET ${ST}`]: settingsAnswer(),
    },
    extra,
  );
}
