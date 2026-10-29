import { describe, expect, it } from 'vitest';
import { declaredEssence, declaredTypeDetail, shownType } from '#/service/declared-type';

const ACCEPTED = ['image/png', 'image/jpeg', 'application/octet-stream'];

describe('declaredEssence', () => {
  it('drops parameters and case', () => {
    expect(declaredEssence('IMAGE/PNG; x=y')).toBe('image/png');
    expect(declaredEssence('  image/png ')).toBe('image/png');
  });

  it('is undefined for none or an empty one', () => {
    expect(declaredEssence(undefined)).toBeUndefined();
    expect(declaredEssence('; charset=utf-8')).toBeUndefined();
  });
});

describe('shownType', () => {
  it('replaces what a media type cannot hold, and bounds the length', () => {
    expect(shownType('text/"><script>')).toBe('text/???script?');
    expect(shownType('a'.repeat(5000))).toHaveLength(61);
  });
});

describe('declaredTypeDetail', () => {
  it('names the declared type and the accepted ones', () => {
    expect(declaredTypeDetail('text/plain', ACCEPTED)).toBe(
      'the declared type is text/plain, not image/png, image/jpeg or application/octet-stream',
    );
  });

  it('says when none was declared', () => {
    expect(declaredTypeDetail(undefined, ACCEPTED)).toMatch(/^no type was declared, not /u);
  });

  it('is not the refusal for bytes', () => {
    expect(declaredTypeDetail('text/plain', ACCEPTED)).not.toContain('the image is not');
  });
});
