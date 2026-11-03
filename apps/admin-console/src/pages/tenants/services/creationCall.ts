import { type AdminCapability } from '#/shared/services/principal';
import { fieldErrorsOf } from '#/shared/services/fieldErrors';
import { CONSOLE_FAULT, failureTextWith } from '#/shared/services/failure';
import type { GatewayFailure } from '#/shared/services/result';
import {
  ADMINISTRATOR_REQUEST_NEEDS,
  type AdministratorCall,
  type AdministratorRequest,
} from '#/entities/administrator';

// A request of a step: what it names when it fails, which fields a refusal
// is placed under, and the capability a 403 says is missing.
export interface StepCall {
  what: string;
  fields: readonly string[];
  needed: AdminCapability;
}

export function createTenantCall(name: string): StepCall {
  return {
    what: `${name} was created`,
    fields: ['name', 'display_name'],
    needed: 'manage-tenants',
  };
}

export function findTenantCall(name: string): StepCall {
  return { what: `${name} exists`, fields: [], needed: 'manage-tenants' };
}

export function findAdministratorCall(username: string): StepCall {
  return {
    what: `looking for ${username}`,
    fields: [],
    needed: ADMINISTRATOR_REQUEST_NEEDS.find,
  };
}

export function stepFailureText(call: StepCall, failure: GatewayFailure): string {
  const { what, needed } = call;
  return failureTextWith({
    network: () =>
      `Could not confirm that ${what}. Nothing was sent again; check before trying again.`,
    schema: () =>
      `${what} may have happened, but the answer could not be read. Check before trying again.`,
    defect: () => `The console could not finish: ${what} did not happen. ${CONSOLE_FAULT}`,
    problem: ({ status, detail, title }) =>
      status === 403 ? `Refused: ${what} needs the ${needed} capability.` : (detail ?? title),
  })(failure);
}

export interface StepRefusal {
  // Null leaves the field errors as they are.
  errors: Readonly<Record<string, string>> | null;
  message: string | null;
  // The answer was lost: offer to look rather than send again.
  unconfirmed: boolean;
}

// A 400 or 409 is placed under the fields it names; what names none goes
// under the first field, or is said for the step as a whole.
export function stepRefusal(failure: GatewayFailure, call: StepCall): StepRefusal {
  const unconfirmed = failure.kind === 'network';
  if (
    failure.kind !== 'problem' ||
    (failure.problem.status !== 400 && failure.problem.status !== 409)
  ) {
    return { errors: null, message: stepFailureText(call, failure), unconfirmed };
  }
  const placed = fieldErrorsOf(failure.problem, call.fields);
  const [first] = call.fields;
  const other = placed.other.join(' ');
  if (Object.keys(placed.fields).length > 0) {
    return { errors: placed.fields, message: null, unconfirmed };
  }
  if (first !== undefined && other !== '') {
    return { errors: { [first]: other }, message: null, unconfirmed };
  }
  return {
    errors: {},
    message: other === '' ? stepFailureText(call, failure) : other,
    unconfirmed,
  };
}

export type AdministratorFailure =
  { kind: 'lost'; message: string } | { kind: 'refused'; call: StepCall };

// A lost answer to the create is looked for; one to a later call is safe to
// continue from, since only what did not land is repeated.
export function administratorFailure(
  failure: GatewayFailure,
  call: AdministratorCall,
  request: AdministratorRequest,
  username: string,
): AdministratorFailure {
  const needed = ADMINISTRATOR_REQUEST_NEEDS[request];
  if (failure.kind === 'network' && call === 'create') {
    return { kind: 'refused', call: { what: `${username} was created`, fields: [], needed } };
  }
  if (failure.kind === 'network') {
    return {
      kind: 'lost',
      message: `Could not confirm the last step for ${username}. Continuing again is safe: it repeats only what did not land.`,
    };
  }
  return {
    kind: 'refused',
    call:
      call === 'create'
        ? { what: `creating ${username}`, fields: ['username', 'email'], needed }
        : { what: `finishing ${username}`, fields: [], needed },
  };
}

export function tenantNotCreatedText(name: string): string {
  return `${name} was not created. Create it again.`;
}

export function administratorLookupText(username: string, found: boolean): string {
  return found
    ? `${username} was created. Continue to finish.`
    : `${username} was not created. Create the administrator again.`;
}
