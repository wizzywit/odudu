import { describe, expect, it } from 'vitest';
import {
  createdText,
  createFailure,
  deletedText,
  enabledText,
  isMissing,
  isRefused,
  isStale,
  isUnknownTenant,
  lookupText,
  writeFailureText,
  type CreateSpec,
  type WriteCopy,
} from '#/shared/service/failure.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/service/result.ts';

function problem(status: number, extra: { detail?: string; type?: string } = {}): GatewayFailure {
  return {
    ok: false,
    kind: 'problem',
    problem: { type: extra.type ?? 'about:blank', title: `T${String(status)}`, status, ...extra },
  };
}
const NETWORK: GatewayFailure = { ok: false, kind: 'network' };
const SCHEMA: GatewayFailure = { ok: false, kind: 'schema' };
const DEFECT: GatewayFailure = { ok: false, kind: 'defect' };
const OK: GatewayResult<null> = { ok: true, status: 200, data: null, etag: null, next: null };

describe('isRefused, isStale and isMissing', () => {
  it('each answer for one status of a problem, and no for everything else', () => {
    expect([isRefused(problem(403)), isRefused(problem(412)), isRefused(NETWORK)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isStale(problem(412)), isStale(problem(403)), isStale(DEFECT)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isMissing(problem(404)), isMissing(problem(409)), isMissing(SCHEMA)]).toEqual([
      true,
      false,
      false,
    ]);
    expect([isRefused(OK), isStale(OK), isMissing(OK)]).toEqual([false, false, false]);
  });
});

describe('writeFailureText', () => {
  const copy: WriteCopy = { name: 'eng/ops', verb: 'deleted', lookAt: 'the groups' };

  it('says what could not be confirmed, read or finished', () => {
    expect(writeFailureText(NETWORK, copy)).toBe(
      'Could not confirm whether eng/ops was deleted. It has not been sent again; look at the groups before trying again.',
    );
    expect(writeFailureText(SCHEMA, copy)).toBe(
      'eng/ops may have been deleted, but the answer could not be read. Reload to check.',
    );
    expect(writeFailureText(DEFECT, copy)).toBe(
      'The console could not finish, so eng/ops was not deleted. This is a fault in the console, not something you did.',
    );
  });

  it("quotes the server's reason for a problem nobody worded", () => {
    expect(writeFailureText(problem(400, { detail: 'too long' }), copy)).toBe(
      'eng/ops was not deleted: too long',
    );
    expect(writeFailureText(problem(500), copy)).toBe('eng/ops was not deleted: T500');
  });

  it('prefers the feature wording for a refusal, a stale write and a missing record', () => {
    const worded: WriteCopy = {
      ...copy,
      refused: (p) => (p.status === 403 ? 'Refused: no.' : null),
      stale: 'It changed meanwhile.',
      missing: 'It is gone.',
    };
    expect(writeFailureText(problem(403), worded)).toBe('Refused: no.');
    expect(writeFailureText(problem(412), worded)).toBe('It changed meanwhile.');
    expect(writeFailureText(problem(404), worded)).toBe('It is gone.');
    expect(writeFailureText(problem(400, { detail: 'x' }), worded)).toBe(
      'eng/ops was not deleted: x',
    );
  });

  it('keeps the plain wording when the feature words none of them', () => {
    expect(writeFailureText(problem(412), copy)).toBe('eng/ops was not deleted: T412');
  });
});

describe('createFailure', () => {
  const spec: CreateSpec = {
    noun: 'group',
    name: 'ops',
    fields: ['name', 'description'],
    taken: { field: 'name', fallback: 'That name is taken there' },
    capability: 'manage-tenant',
  };

  it('offers a look instead of a resend when the answer was lost', () => {
    const lost = createFailure(NETWORK, spec);
    expect(lost).toEqual({
      unconfirmed: true,
      errors: {},
      message:
        'Could not confirm whether ops was created. It has not been sent again; look for it before trying again.',
      report: false,
    });
    expect(createFailure(SCHEMA, spec).unconfirmed).toBe(true);
  });

  it('keeps a page own wording for an answer that arrived unreadable', () => {
    const worded: CreateSpec = { ...spec, schema: 'ops may have been created. Look for it.' };
    expect(createFailure(SCHEMA, worded)).toMatchObject({
      unconfirmed: true,
      message: 'ops may have been created. Look for it.',
    });
    expect(createFailure(NETWORK, worded).message).toMatch(/^Could not confirm whether ops/u);
  });

  it('calls a defect a fault in the console, with nothing to look for', () => {
    expect(createFailure(DEFECT, spec)).toEqual({
      unconfirmed: false,
      errors: {},
      message:
        'The console could not create the group. This is a fault in the console, not something you did.',
      report: false,
    });
  });

  it('puts a conflict under the field that was taken, in the conflict own words when it has them', () => {
    expect(createFailure(problem(409, { detail: 'name already used' }), spec).errors).toEqual({
      name: 'Name already used.',
    });
    expect(createFailure(problem(409), spec).errors).toEqual({ name: 'That name is taken there.' });
  });

  it('words a refusal, and asks for whoami to be read again', () => {
    const outcome = createFailure(problem(403), spec);
    expect(outcome.report).toBe(true);
    expect(outcome.message).toBe(
      'Refused: it needs the manage-tenant capability, or reaches a capability you do not hold.',
    );
    expect(createFailure(problem(403), { ...spec, refused: () => 'Mine.' }).message).toBe('Mine.');
  });

  it('places a rejected field, and says the rest for the form as a whole', () => {
    const rejected: GatewayFailure = {
      ok: false,
      kind: 'problem',
      problem: {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        errors: [
          { path: 'name', message: 'too long' },
          { path: 'elsewhere', message: 'odd' },
        ],
      },
    };
    expect(createFailure(rejected, spec)).toEqual({
      unconfirmed: false,
      errors: { name: 'too long' },
      message: 'elsewhere: odd',
      report: false,
    });
  });

  it('lets a conflict fall through to fields when the spec names no taken field', () => {
    const untaken: CreateSpec = {
      noun: spec.noun,
      name: spec.name,
      fields: spec.fields,
      capability: spec.capability,
    };
    expect(createFailure(problem(409, { detail: 'x' }), untaken).errors).toEqual({});
  });
});

describe('lookupText', () => {
  it('says a look failed, and that nothing was found, so creating again is safe', () => {
    expect(lookupText('group', 'ops', 'there')).toEqual({
      failed: 'Could not look for ops. Try again.',
      missing:
        'No group named ops was found there, so it was not created. Creating it again is safe.',
    });
    expect(lookupText('role', 'ops').missing).toBe(
      'No role named ops was found, so it was not created. Creating it again is safe.',
    );
  });
});

describe('success copy', () => {
  it('names what was created, deleted and enabled or disabled', () => {
    expect(createdText('eng/ops')).toBe('eng/ops was created.');
    expect(deletedText('ops')).toBe('ops was deleted.');
    expect(enabledText('ada', true)).toBe('ada is enabled.');
    expect(enabledText('ada', false)).toBe('ada is disabled.');
  });
});

describe('isUnknownTenant', () => {
  it('is the plain 401 the admin API passes through, not the gateway ended-session one', () => {
    expect(isUnknownTenant(problem(401))).toBe(true);
    expect(isUnknownTenant(problem(401, { type: 'about:blank#console-session-ended' }))).toBe(
      false,
    );
    expect(isUnknownTenant(problem(403))).toBe(false);
    expect(isUnknownTenant(NETWORK)).toBe(false);
    expect(isUnknownTenant(OK)).toBe(false);
    expect(isUnknownTenant(undefined)).toBe(false);
  });
});

describe('a name that begins a sentence', () => {
  it('is lowered when it comes after "whether"', () => {
    const copy = { name: 'The secret of Ada', verb: 'rotated', lookAt: 'the client' };
    expect(writeFailureText({ ok: false, kind: 'network' }, copy)).toContain(
      'whether the secret of Ada was rotated',
    );
    expect(writeFailureText({ ok: false, kind: 'defect' }, copy)).toContain(
      'so the secret of Ada was not rotated',
    );
  });

  it('keeps a proper name as it is', () => {
    const copy = { name: 'Ada', verb: 'deleted', lookAt: 'the list' };
    expect(writeFailureText({ ok: false, kind: 'network' }, copy)).toContain('whether Ada was');
  });
});
