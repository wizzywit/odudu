import { describe, expect, it } from 'vitest';
import {
  heldOf,
  reachOf,
  canManageSubject,
  subjectBeyond,
  beyondText,
} from '#/features/subjects/service/reach.ts';

describe('small model reads', () => {
  it('holds what the roles give once read, and nothing before', () => {
    const items = [
      {
        id: 'r',
        name: 'view-audit',
        client_id: 'c',
        client_key: 'odudu-admin',
        via: [{ kind: 'direct' }],
      },
    ];
    const retry = () => undefined;
    expect([
      ...heldOf({ status: 'ready', data: { items } as never, retry } as never).keys(),
    ]).toEqual(['view-audit']);
    expect(heldOf({ status: 'loading' }).size).toBe(0);
    expect(heldOf({ status: 'failed', retry }).size).toBe(0);
  });
});

describe('what a subject holds beyond the caller', () => {
  const effective = (names: string[]) =>
    ({
      status: 'ready',
      retry: () => undefined,
      data: {
        items: names.map((name) => ({
          id: name,
          name,
          client_id: 'c',
          client_key: 'odudu-admin',
          via: [{ kind: 'direct' }],
        })),
      },
    }) as never;

  it('is what the subject holds and the caller does not, nothing until both are known', () => {
    expect(subjectBeyond(effective(['manage-keys', 'view-audit']), ['view-audit'])).toEqual([
      'manage-keys',
    ]);
    expect(subjectBeyond(effective(['manage-keys']), undefined)).toEqual([]);
    expect(subjectBeyond({ status: 'loading' }, ['view-audit'])).toEqual([]);
  });

  it('is changeable once whoami allows it, the reach is read and nothing is beyond', () => {
    expect(canManageSubject([], 'ready', [])).toBe(true);
    expect(canManageSubject(['manage-users'], 'ready', [])).toBe(false);
    expect(canManageSubject([], 'loading', [])).toBe(false);
    expect(canManageSubject([], 'ready', ['manage-keys'])).toBe(false);
  });

  it('says whether the reach is being checked, read, or could not be', () => {
    const retry = () => undefined;
    expect(reachOf({ status: 'loading' })).toBe('checking');
    expect(reachOf(effective([]))).toBe('ready');
    expect(reachOf({ status: 'failed', retry })).toEqual({ failed: true, retry });
  });

  it('tells the reader what is beyond them, for changing or for viewing', () => {
    expect(beyondText('ada', ['manage-keys', 'view-audit'], 'change')).toBe(
      'ada holds manage-keys and view-audit, which you do not, so you cannot change what ada holds.',
    );
    expect(beyondText('ada', ['manage-keys'], 'view')).toBe(
      'ada holds manage-keys, which you do not, so you can view ada but change nothing here.',
    );
  });
});
