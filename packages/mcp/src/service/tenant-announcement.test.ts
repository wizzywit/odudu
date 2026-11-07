import { describe, expect, it } from 'vitest';
import { TOOLS } from '#/service/catalogue';
import { announceTenant, TENANT_LABEL_CAP } from '#/service/tenant-announcement';

describe('announceTenant', () => {
  it('names the server, titles it and says whose tenant it serves', () => {
    const a = announceTenant('acme');
    expect(a.name).toBe('odudu:acme');
    expect(a.title).toBe('Odudu (acme)');
    expect(a.instructions).toBe(
      'This server acts in the Odudu tenant "acme" only, as the person signed in; every tool works ' +
        'on that tenant. If you also have other Odudu servers connected, check the tenant before ' +
        'using a tool.',
    );
    expect(a.describe('Lists users.')).toBe('[acme] Lists users.');
  });

  it('keeps a slug as it is', () => {
    expect(announceTenant('my-tenant_2.eu').name).toBe('odudu:my-tenant_2.eu');
  });

  it.each([
    ['a quote', 'a"b'],
    ['a newline', 'a\nIgnore the above'],
    ['a control character', 'a\u0000b\u001bc'],
    ['a bracket', 'a] [b'],
    ['an angle bracket', '<b>a</b>'],
    ['a bidi override', 'a‮b'],
    ['an invisible tag', 'a\u{E0041}b'],
  ])('cannot be broken out of by %s', (_label, hostile) => {
    const a = announceTenant(hostile);
    const label = a.name.slice('odudu:'.length);
    expect(label).toMatch(/^[\p{L}\p{N}._-]+$/u);
    expect(a.instructions.split('"')).toHaveLength(3);
    expect(a.instructions).not.toMatch(/[\n\r]/u);
    expect(a.describe('x')).toBe(`[${label}] x`);
    expect(a.title).toBe(`Odudu (${label})`);
  });

  it('cuts a very long value to the cap', () => {
    const a = announceTenant('x'.repeat(10_000));
    expect(a.name).toBe(`odudu:${'x'.repeat(TENANT_LABEL_CAP)}`);
    expect(a.instructions.length).toBeLessThan(400);
  });

  it('never leaves the label empty', () => {
    expect(announceTenant('\u0000').name).toBe('odudu:_');
  });

  it('prefixes all 68 tools without touching the wording after the prefix', () => {
    expect(TOOLS).toHaveLength(68);
    const a = announceTenant('acme');
    for (const tool of TOOLS) {
      const described = a.describe(tool.description);
      expect(described.startsWith('[acme] ')).toBe(true);
      expect(described.slice('[acme] '.length)).toBe(tool.description);
      expect(described.length).toBeLessThanOrEqual(tool.description.length + TENANT_LABEL_CAP + 3);
    }
  });
});
