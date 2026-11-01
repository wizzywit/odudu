import { describe, expect, it } from 'vitest';
import { MAX_SLOT_NAME_LENGTH, MAX_TEMPLATE_LENGTH, fillTemplate, scanSlots } from '#/slots';

// Catches only a catastrophic regression: an uncapped parse costs seconds,
// so 2 s sits far above the capped path and tolerates a loaded runner.
const CATASTROPHIC_MS = 2000;

const t = (key: string): string => `<${key}>`;

describe('fillTemplate', () => {
  it('fills a part and escapes a catalogue value', () => {
    const out = fillTemplate('<p>{{t "a.b"}}</p>{{submit}}', { submit: '<button>Go</button>' }, t);
    expect(out).toBe('<p>&lt;a.b&gt;</p><button>Go</button>');
  });

  it('inserts a part verbatim', () => {
    expect(fillTemplate('{{error}}', { error: '<p class="e">a & b</p>' }, t)).toBe(
      '<p class="e">a & b</p>',
    );
  });

  it('escapes the backtick', () => {
    expect(fillTemplate('{{t "a.b"}}', {}, () => '`x`')).toBe('&#96;x&#96;');
  });

  it('an unknown slot throws', () => {
    expect(() => fillTemplate('{{nope}}', {}, t)).toThrow(/nope/);
  });

  it('a malformed slot throws instead of passing through', () => {
    expect(() => fillTemplate('{{ submit }}', { submit: 'x' }, t)).toThrow();
    expect(() => fillTemplate('{{t catalogue}}', {}, t)).toThrow();
    expect(() => fillTemplate('a }} b', {}, t)).toThrow();
  });

  it('refuses a template over the size bound', () => {
    expect(() => fillTemplate('a'.repeat(MAX_TEMPLATE_LENGTH + 1), {}, t)).toThrow(/too long/);
  });

  it('does not rescan an inserted part', () => {
    expect(fillTemplate('{{a}}', { a: '{{b}}' }, t)).toBe('{{b}}');
  });

  it('a slot appearing twice is filled twice; the check owns the count', () => {
    expect(fillTemplate('{{a}}{{a}}', { a: 'x' }, t)).toBe('xx');
  });
});

describe('scanSlots', () => {
  it('lists parts and text keys in order', () => {
    expect(scanSlots('{{form.open}}{{t "x.y"}}{{submit}}')).toEqual([
      { kind: 'part', name: 'form.open', index: 0, end: 13 },
      { kind: 'text', name: 'x.y', index: 13, end: 24 },
      { kind: 'part', name: 'submit', index: 24, end: 34 },
    ]);
  });

  it('reports a stray brace pair as malformed', () => {
    expect(scanSlots('a {{ b }} c')).toEqual([
      { kind: 'malformed', name: '', index: 2, end: 4 },
      { kind: 'malformed', name: '', index: 7, end: 9 },
    ]);
    expect(scanSlots('x }}')).toEqual([{ kind: 'malformed', name: '', index: 2, end: 4 }]);
  });

  it('is linear on a hostile input of the largest size', () => {
    const hostile = '{{'.repeat(200_000) + 'a'.repeat(MAX_SLOT_NAME_LENGTH * 4);
    const started = performance.now();
    scanSlots(hostile);
    expect(performance.now() - started).toBeLessThan(CATASTROPHIC_MS);
  });
});
