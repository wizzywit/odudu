import { describe, expect, it } from 'vitest';
import type { FlowListItemWire } from '#/pages/flow/types/flows';
import {
  creationOf,
  createSpec,
  deleteDialog,
  deleteOutcome,
  promoteDialog,
  promoteOutcome,
  flowRows,
  nameTakenExplanation,
  stepSummary,
} from '#/pages/flow/services/flows';
import { createFailure } from '#/shared/lib/services/failure';
import type { GatewayFailure } from '#/shared/lib/services/result';

const PASSWORD = { authenticator: 'password', requirement: 'required' } as const;
const OTP = { authenticator: 'otp', requirement: 'conditional' } as const;

const DEFAULT: FlowListItemWire = {
  id: 'f-1',
  name: 'default',
  is_default: true,
  steps: [PASSWORD, OTP],
  client_count: 0,
};
const STAFF: FlowListItemWire = {
  id: 'f-2',
  name: 'staff',
  is_default: false,
  steps: [PASSWORD],
  client_count: 2,
};

function problemResult(status: number, type: string, detail = 'x'): GatewayFailure {
  return { ok: false, kind: 'problem', problem: { status, type, title: 'T', detail } };
}

describe('flowRows', () => {
  it('marks the default, which has no delete, and addresses each flow by its id', () => {
    const rows = flowRows('acme', [DEFAULT, STAFF]);
    expect(rows.map((row) => [row.flow.name, row.isDefault, row.deletable])).toEqual([
      ['default', true, false],
      ['staff', false, true],
    ]);
    expect(rows[1]).toMatchObject({
      href: '/console/acme/flow/f-2',
      editLabel: 'Edit staff',
      deleteLabel: 'Delete staff',
      promotable: true,
      promoteLabel: 'Make staff the default',
    });
    expect(rows[0]?.promotable).toBe(false);
  });

  it('says how many clients name each flow', () => {
    const rows = flowRows('acme', [DEFAULT, STAFF, { ...STAFF, id: 'f-3', client_count: 1 }]);
    expect(rows.map((row) => row.clients)).toEqual(['None', '2 clients', '1 client']);
  });
});

describe('flowRows of nothing', () => {
  it('is no rows until the flows are read', () => {
    expect(flowRows('acme', undefined)).toEqual([]);
  });
});

describe('stepSummary', () => {
  it('names the steps in order, or says there are none', () => {
    expect(stepSummary([PASSWORD, OTP])).toBe('2 steps: password, otp');
    expect(stepSummary([PASSWORD])).toBe('1 step: password');
    expect(stepSummary([])).toBe('No steps');
  });
});

describe('creationOf', () => {
  it('starts the flow as a copy of the default steps, with the name trimmed', () => {
    expect(creationOf('  staff ', [STAFF, DEFAULT])).toEqual({
      problem: null,
      send: { name: 'staff', steps: [PASSWORD, OTP] },
    });
  });

  it('asks for a name, and refuses one past 64 characters by code points', () => {
    expect(creationOf('   ', [DEFAULT]).problem).toEqual({ field: 'name', text: 'Enter a name.' });
    expect(creationOf('\u{1F512}'.repeat(65), [DEFAULT]).problem?.text).toBe(
      'Use at most 64 characters.',
    );
    expect(creationOf('\u{1F512}'.repeat(64), [DEFAULT]).problem).toBeNull();
  });

  it('says so when the tenant has no default to start from', () => {
    expect(creationOf('staff', [STAFF]).problem).toEqual({
      field: 'name',
      text: 'This tenant has no default flow to copy the steps from.',
    });
  });
});

describe('createSpec', () => {
  it('places a 409 under the name, in the server’s own sentence', () => {
    const outcome = createFailure(
      problemResult(409, 'about:blank#flow-name-taken', 'a flow named "staff" already exists'),
      createSpec('staff'),
    );
    expect(outcome.errors).toEqual({ name: 'A flow named "staff" already exists.' });
    const full = createFailure(
      problemResult(409, 'about:blank#flow-limit', 'a tenant holds at most 20 flows'),
      createSpec('staff'),
    );
    expect(full.errors).toEqual({ name: 'A tenant holds at most 20 flows.' });
  });
});

describe('deleteDialog and deleteOutcome', () => {
  it('asks for the flow by name, in danger', () => {
    expect(deleteDialog(null)).toBeNull();
    expect(deleteDialog(STAFF)).toMatchObject({
      title: 'Delete staff?',
      confirmLabel: 'Delete staff',
      tone: 'danger',
    });
    expect(deleteDialog(STAFF)?.consequence).toBe(
      'The flow and its steps are removed for good, once the 2 clients that use it use another.',
    );
    expect(deleteDialog(DEFAULT)?.consequence).toBe('The flow and its steps are removed for good.');
  });

  it('says the flow is gone, and words the refusal of the default', () => {
    expect(
      deleteOutcome('staff', { ok: true, status: 204, data: undefined, etag: null, next: null }),
    ).toEqual({
      done: true,
      text: 'staff was deleted.',
    });
    expect(deleteOutcome('staff', problemResult(404, 'about:blank#not-found'))).toEqual({
      done: true,
      text: 'staff was already deleted.',
    });
    expect(deleteOutcome('default', problemResult(409, 'about:blank#default-flow'))).toEqual({
      done: false,
      text: 'The default flow is not deleted: a sign-in that names no flow runs it. Replace its steps instead.',
    });
  });

  it('words the refusal of a flow a client names, with how many were counted', () => {
    const refused = problemResult(409, 'about:blank#flow-in-use');
    expect(deleteOutcome('staff', refused, 2)).toEqual({
      done: false,
      text: '2 clients use staff. Choose another Sign-in flow for each under Advanced on its page, then delete it.',
    });
    expect(deleteOutcome('staff', refused, 1).text).toMatch(/^A client uses staff\./u);
    expect(deleteOutcome('staff', refused, 0).text).toMatch(/^A client uses staff\./u);
  });
});

describe('nameTakenExplanation', () => {
  it('words only the refusal of a taken name', () => {
    expect(
      nameTakenExplanation({ status: 409, type: 'about:blank#flow-name-taken', title: 'T' }),
    ).toBe('That name belongs to another flow of this tenant. Choose another.');
    expect(nameTakenExplanation({ status: 409, type: 'about:blank', title: 'T' })).toBeNull();
  });
});

describe('promoteDialog and promoteOutcome', () => {
  it('asks for the flow by name, saying what changes', () => {
    expect(promoteDialog(STAFF)).toMatchObject({
      title: 'Make staff the default?',
      confirmLabel: 'Make default',
      tone: 'primary',
    });
    expect(promoteDialog(STAFF).consequence).toMatch(/next step/u);
  });

  it('says the flow is now the default, and words a stale tag and a missing flow', () => {
    expect(
      promoteOutcome('staff', { ok: true, status: 200, data: 1, etag: null, next: null }),
    ).toEqual({
      done: true,
      text: 'staff is now the default flow.',
    });
    expect(promoteOutcome('staff', problemResult(412, 'about:blank')).done).toBe(false);
    expect(promoteOutcome('staff', problemResult(412, 'about:blank')).text).toMatch(/changed/u);
    expect(promoteOutcome('staff', problemResult(404, 'about:blank')).text).toMatch(/no longer/u);
  });
});
