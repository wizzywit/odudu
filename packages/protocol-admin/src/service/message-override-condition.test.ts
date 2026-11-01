import { describe, expect, it } from 'vitest';
import {
  messageOverrideEtag,
  overrideCondition,
  overrideConditionHolds,
} from '#/service/message-override-condition';

const row = {
  locale: 'fr',
  key: 'login.title',
  message: 'Connexion',
  updatedAt: new Date('2026-10-30T10:00:00.000Z'),
};

describe('overrideCondition', () => {
  it('reads If-None-Match: * as a create', () => {
    expect(overrideCondition(undefined, '*')).toEqual({ kind: 'create' });
  });

  it('reads an If-Match that names a version as a replace of that version', () => {
    expect(overrideCondition('"abc"', undefined)).toEqual({ kind: 'replace', ifMatch: '"abc"' });
  });

  it.each([
    ['no header', undefined, undefined],
    ['a wildcard If-Match', '*', undefined],
    ['an If-None-Match that is not the wildcard', undefined, '"abc"'],
    ['both headers', '"abc"', '*'],
  ])('requires a precondition for %s', (_label, ifMatch, ifNoneMatch) => {
    expect(overrideCondition(ifMatch, ifNoneMatch)).toEqual({ kind: 'required' });
  });
});

describe('messageOverrideEtag', () => {
  it('changes with the message and with the time it was written', () => {
    const base = messageOverrideEtag(row);
    expect(messageOverrideEtag({ ...row, message: 'Se connecter' })).not.toBe(base);
    expect(
      messageOverrideEtag({ ...row, updatedAt: new Date('2026-10-30T10:00:01.000Z') }),
    ).not.toBe(base);
    expect(messageOverrideEtag({ ...row })).toBe(base);
  });

  it('is a quoted strong validator', () => {
    expect(messageOverrideEtag(row)).toMatch(/^"[0-9a-f]{64}"$/u);
  });
});

describe('overrideConditionHolds', () => {
  it('lets a create through only where nothing is stored', () => {
    expect(overrideConditionHolds({ kind: 'create' }, null)).toBe(true);
    expect(overrideConditionHolds({ kind: 'create' }, row)).toBe(false);
  });

  it('lets a replace through only where the stored version is the one named', () => {
    const ifMatch = messageOverrideEtag(row);
    expect(overrideConditionHolds({ kind: 'replace', ifMatch }, row)).toBe(true);
    expect(overrideConditionHolds({ kind: 'replace', ifMatch }, { ...row, message: 'x' })).toBe(
      false,
    );
    expect(overrideConditionHolds({ kind: 'replace', ifMatch }, null)).toBe(false);
  });
});
