import { PAGE_KINDS, type PageKind } from '@odudu/kernel';
import { stylesheetHooks } from '@odudu/protocol-admin/docs';
import { describe, expect, it } from 'vitest';
import { PART_DESCRIPTIONS, renderBrandingPage } from './branding-page.ts';

const text = renderBrandingPage();
const lines = text.split('\n');
const kinds = Object.keys(PAGE_KINDS) as PageKind[];

function row(first: string): string | undefined {
  return lines.find((line) => line.startsWith(`| ${first} |`));
}

function section(heading: string): string {
  const start = text.indexOf(`\n### ${heading}\n`);
  expect(start, heading).toBeGreaterThan(-1);
  return text.slice(start + 5).split('\n###')[0] ?? '';
}

describe('the branding reference', () => {
  it('lists every page kind with its required and optional parts', () => {
    for (const kind of kinds) {
      const line = row(`\`${kind}\``);
      expect(line, kind).toBeDefined();
      const manifest = PAGE_KINDS[kind];
      for (const part of manifest.required)
        expect(line, `${kind} ${part}`).toContain(`{{${part}}}`);
      for (const part of manifest.optional)
        expect(line, `${kind} ${part}`).toContain(`{{${part}}}`);
      const [, , required = '', optional = ''] = (line ?? '').split(' | ');
      expect(required.match(/\{\{/gu)?.length ?? 0, `${kind} required`).toBe(
        manifest.required.length,
      );
      expect(optional.replace(/ \|$/u, '').match(/\{\{/gu)?.length ?? 0, `${kind} optional`).toBe(
        manifest.optional.length,
      );
    }
  });

  it('describes every part a page kind names', () => {
    const named = new Set(
      Object.values(PAGE_KINDS).flatMap((manifest) => [...manifest.required, ...manifest.optional]),
    );
    for (const part of named) expect(PART_DESCRIPTIONS[part], part).toBeDefined();
    for (const part of Object.keys(PART_DESCRIPTIONS)) expect(named.has(part), part).toBe(true);
    const held = section('What each part holds');
    for (const part of named) expect(held, part).toContain(`| \`{{${part}}}\` |`);
  });

  it('lists the parts that must sit inside the form, for each kind that has any', () => {
    const inside = section('Parts that sit inside the form');
    for (const kind of kinds) {
      const { inForm } = PAGE_KINDS[kind];
      if (inForm.length === 0) expect(inside).not.toContain(`| \`${kind}\` |`);
      else for (const part of inForm) expect(inside, `${kind} ${part}`).toContain(`{{${part}}}`);
    }
  });

  it('lists every CSS hook the stylesheet check accepts, under its version', () => {
    const hooks = stylesheetHooks();
    expect(text).toContain(`version ${String(hooks.version)} of the list`);
    const groups: [string, readonly string[], string][] = [
      ['Classes the pages render', hooks.classes, '.'],
      ['One class for each page kind', hooks.page_kind_classes, '.'],
      ['Elements', hooks.elements, ''],
      ['States', hooks.pseudo_classes, ':'],
      ['Parts of an element', hooks.pseudo_elements, '::'],
      ['Design values', hooks.tokens, ''],
    ];
    for (const [heading, names, prefix] of groups) {
      const body = section(heading);
      const listed = body.split('\n').filter((line) => line.startsWith('| `'));
      expect(listed, heading).toEqual(names.map((name) => `| \`${prefix}${name}\` |`));
    }
  });

  it('has a class for each page kind', () => {
    for (const kind of kinds)
      expect(section('One class for each page kind')).toContain(`.page-${kind}`);
  });

  it('links the concept page, which exists at that path', () => {
    expect(text).toContain('(../../concepts/branding.mdx)');
  });
});
