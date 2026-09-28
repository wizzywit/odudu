import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldPath } from '#/service/field-path';
import {
  ceilingProblem,
  fieldProblem,
  problem,
  queryProblem,
  refusalDetail,
  validationErrors,
} from '#/view/problem';

describe('problem', () => {
  it('carries type, title, status and the request id as instance', () => {
    expect(problem(403, 'about:blank#forbidden', 'Forbidden', 'manage-users required')).toEqual({
      type: 'about:blank#forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'manage-users required',
    });
  });

  it('omits detail rather than emitting null', () => {
    expect(problem(401, 'about:blank#unauthorized', 'Unauthorized')).not.toHaveProperty('detail');
  });
});

describe('refusalDetail', () => {
  it('names the property a closed schema refused', () => {
    const error = Object.assign(new Error('querystring must NOT have additional properties'), {
      validation: [
        {
          keyword: 'additionalProperties',
          instancePath: '',
          schemaPath: '#/additionalProperties',
          params: { additionalProperty: 'search' },
          message: 'must NOT have additional properties',
        },
      ],
    });
    expect(refusalDetail(error)).toBe('querystring must NOT have additional properties: search');
  });

  it('leaves any other message as it is', () => {
    expect(refusalDetail(new Error('body/name must be string'))).toBe('body/name must be string');
  });
});

describe('ceilingProblem', () => {
  it('names what a write grants apart from what it removes', () => {
    expect(ceilingProblem(['manage-users'], ['view-audit']).detail).toBe(
      'the caller does not hold: manage-users; ' +
        'this removes capabilities the caller does not hold: view-audit',
    );
    expect(ceilingProblem([], ['view-audit']).detail).toBe(
      'this removes capabilities the caller does not hold: view-audit',
    );
    expect(ceilingProblem(['manage-users']).detail).toBe('the caller does not hold: manage-users');
  });
});

describe('fieldProblem', () => {
  it('is a 400 whose detail reads each field and whose errors name it', () => {
    expect(fieldProblem([{ path: 'port', message: 'must be at most 65535' }])).toEqual({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'port: must be at most 65535',
      errors: [{ path: 'port', message: 'must be at most 65535' }],
    });
  });

  it('keeps the prose a caller already reads when it is given', () => {
    const body = fieldProblem(
      [{ path: 'role_ids', message: 'names no role' }],
      'unknown role id(s): x',
    );
    expect(body.detail).toBe('unknown role id(s): x');
    expect(body.errors).toEqual([{ path: 'role_ids', message: 'names no role' }]);
  });
});

describe('fieldPath', () => {
  it('writes a property as a dotted name and an index in brackets', () => {
    expect(fieldPath(['document', 'clients', 0, 'redirect_uris'])).toBe(
      'document.clients[0].redirect_uris',
    );
    expect(fieldPath([0, 'authenticator'])).toBe('[0].authenticator');
    expect(fieldPath([])).toBe('');
  });
});

describe('queryProblem', () => {
  it('names the field a refinement names, keeping its message as the detail', () => {
    const schema = z
      .object({ a: z.string().optional(), b: z.string().optional() })
      .refine((q) => q.a === undefined || q.b === undefined, { message: 'not both', path: ['b'] });
    const parsed = schema.safeParse({ a: 'x', b: 'y' });
    if (parsed.success) throw new Error('expected a refusal');
    expect(queryProblem(parsed.error)).toMatchObject({
      status: 400,
      detail: 'not both',
      errors: [{ path: 'b', message: 'not both' }],
    });
  });
});

describe('validationErrors', () => {
  const ajvError = (entry: {
    keyword: string;
    instancePath: string;
    params: Record<string, unknown>;
    message: string;
  }) =>
    Object.assign(new Error('body must NOT have additional properties'), {
      validation: [{ schemaPath: '#', ...entry }],
    });

  it('names the property a closed schema refused, where it was sent', () => {
    const error = ajvError({
      keyword: 'additionalProperties',
      instancePath: '/steps/0',
      params: { additionalProperty: 'extra' },
      message: 'must NOT have additional properties',
    });
    expect(validationErrors(error)).toEqual([
      { path: 'steps[0].extra', message: 'must NOT have additional properties' },
    ]);
  });

  it('names the property a request left out', () => {
    const error = ajvError({
      keyword: 'required',
      instancePath: '',
      params: { missingProperty: 'host' },
      message: "must have required property 'host'",
    });
    expect(validationErrors(error)).toEqual([
      { path: 'host', message: "must have required property 'host'" },
    ]);
  });

  it('names the value at fault by its own path', () => {
    const error = ajvError({
      keyword: 'maximum',
      instancePath: '/port',
      params: { limit: 65535 },
      message: 'must be <= 65535',
    });
    expect(validationErrors(error)).toEqual([{ path: 'port', message: 'must be <= 65535' }]);
  });

  it('names nothing when the refusal is of the whole body', () => {
    const error = ajvError({
      keyword: 'type',
      instancePath: '',
      params: { type: 'object' },
      message: 'must be object',
    });
    expect(validationErrors(error)).toEqual([]);
  });
});
