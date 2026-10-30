import { THEME_PAGE_KINDS } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import {
  formNote,
  limitedIssues,
  MANIFESTS,
  omissionNote,
  PAGE_KIND_LABELS,
  PAGE_KIND_OPTIONS,
  pageKindOf,
  slot,
  templateField,
  TEMPLATE_FIELDS,
} from '#/features/branding/service';

describe('the page kinds', () => {
  it('each have a label, a manifest and a field, in the contract’s order', () => {
    expect(PAGE_KIND_OPTIONS.map((option) => option.id)).toEqual([...THEME_PAGE_KINDS]);
    for (const kind of THEME_PAGE_KINDS) {
      expect(PAGE_KIND_LABELS[kind]).not.toBe('');
      expect(MANIFESTS[kind].required.length).toBeGreaterThan(0);
    }
    expect(TEMPLATE_FIELDS).toHaveLength(THEME_PAGE_KINDS.length);
    expect(templateField('sign-in')).toBe('templates.sign-in');
  });

  it('are found by name, or not at all', () => {
    expect(pageKindOf('consent')).toBe('consent');
    expect(pageKindOf('nope')).toBeUndefined();
  });

  it('say where a form’s parts sit, and nothing for a page without a form', () => {
    expect(formNote(MANIFESTS['sign-in'])).toBe(
      'Between {{form.open}} and {{form.close}}: {{fields}}, {{submit}}.',
    );
    expect(formNote(MANIFESTS.notice)).toBeNull();
    expect(slot('form.open')).toBe('{{form.open}}');
  });

  it('say which pages leave a script out of the preview', () => {
    expect(omissionNote('passkey-enrolment')).toMatch(/leaves out/u);
    expect(omissionNote('sign-in')).toBeNull();
    expect(limitedIssues('a')).toBe('a');
  });
});
