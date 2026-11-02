import { expect, it } from 'vitest';
import {
  DEFAULT_MAPPER_NOTE,
  NONE_TEXT,
  boundAfter,
  mapperChecklist,
  mappersFailure,
  mappersFailureText,
  mappersSummary,
  describeMappers,
} from '#/features/scopes/services/mappers';

it('offers every available mapper, in the order the registry names them', () => {
  expect(mapperChecklist(['email', 'groups'], [], ['groups'])).toEqual({
    options: [
      { id: 'email', label: 'email' },
      { id: 'groups', label: 'groups' },
    ],
    value: ['groups'],
  });
});

it('shows the declared mappers ticked and greyed while nothing is bound', () => {
  expect(mapperChecklist(['email', 'groups'], ['email'], [])).toEqual({
    options: [
      { id: 'email', label: 'email', unavailable: DEFAULT_MAPPER_NOTE },
      { id: 'groups', label: 'groups' },
    ],
    value: ['email'],
  });
  expect(DEFAULT_MAPPER_NOTE).toBe('Used because nothing is bound');
});

it('leaves the defaults out once a mapper is bound, and ignores a declared one the registry lacks', () => {
  expect(mapperChecklist(['email', 'groups'], ['email'], ['groups']).value).toEqual(['groups']);
  expect(mapperChecklist(['email'], ['gone'], []).value).toEqual([]);
  expect(mapperChecklist(['email'], ['gone'], []).options).toEqual([
    { id: 'email', label: 'email' },
  ]);
});

it('binds only what was ticked on top of the defaults shown, which then stop applying', () => {
  expect(boundAfter(['email', 'groups'], ['email'], [], ['email', 'groups'])).toEqual(['groups']);
  expect(boundAfter(['email', 'groups'], ['email'], ['groups'], ['email', 'groups'])).toEqual([
    'email',
    'groups',
  ]);
  expect(boundAfter(['email', 'groups'], ['email'], ['groups'], [])).toEqual([]);
});

it('says the declared mappers run when nothing is bound', () => {
  expect(mappersSummary([], ['email', 'groups'])).toBe(
    'Nothing bound. These mappers run by default.',
  );
  expect(mappersSummary(['email'], ['groups'])).toBe('Bound: email.');
});

it('says so when nothing is bound and nothing declares the scope', () => {
  expect(mappersSummary([], [])).toBe(NONE_TEXT);
  expect(NONE_TEXT).toBe('Nothing bound. No mapper runs by default, so this scope adds no claims.');
});

it('names the registry in a 400 for an unknown mapper', () => {
  expect(
    mappersFailureText({
      ok: false,
      kind: 'problem',
      problem: {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        detail: 'unknown mapper name(s): nope; known: email, groups',
      },
    }),
  ).toBe('Not saved: no mapper named nope. The mappers are email and groups.');
});

it('has nothing to add for another failure', () => {
  expect(
    mappersFailureText({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Conflict', status: 409 },
    }),
  ).toBeNull();
});

it('puts the unknown-mapper wording under the mapper field', () => {
  const failure = {
    ok: false as const,
    kind: 'problem' as const,
    problem: {
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'unknown mapper name(s): nope; known: email, groups',
      errors: [{ path: 'mapper_names', message: 'names no registered mapper nope' }],
    },
  };
  expect(mappersFailure(failure).problem.errors).toEqual([
    {
      path: 'mapper_names',
      message: 'Not saved: no mapper named nope. The mappers are email and groups.',
    },
  ]);
  const other = { ...failure, problem: { ...failure.problem, status: 409 } };
  expect(mappersFailure(other)).toBe(other);
});

it('reads a draft mapper list as a sentence, and an empty or odd one as none', () => {
  expect(describeMappers(['email', 'groups'])).toBe('email and groups');
  expect(describeMappers([])).toBe('none');
  expect(describeMappers(undefined)).toBe('none');
});
