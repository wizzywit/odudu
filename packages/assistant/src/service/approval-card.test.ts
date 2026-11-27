import { CARD_FIELD_MAX, SET_DIFF_MAX, SET_DIFF_NAME_MAX } from '@odudu/contracts/admin';
import { TOOLS } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import {
  afterOf,
  oversizeField,
  beforeOf,
  changedFields,
  confirmTextOf,
  cursorOf,
  diffOf,
  readStepOf,
  removesTarget,
  replacesState,
  setDiff,
  stateMoved,
  targetOf,
  tierOfTool,
  titleOf,
  WRITE_PLANS,
  writeToolNames,
} from '#/service/approval-card';
import { approvalPolicy } from '#/service/approval-policy';

const ID = '0192a0a0-0000-7000-8000-0000000000a1';

const byName = (name: string) => {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`no tool ${name}`);
  return tool;
};

describe('the twelve writes', () => {
  it('are exactly the catalogue’s writes, each with a plan and a read that exists', () => {
    const writes = TOOLS.filter((tool) => tool.access === 'write').map((tool) => tool.name);
    expect([...writeToolNames()].sort()).toEqual([...writes].sort());
    expect(writes).toHaveLength(12);
    for (const [name, plan] of Object.entries(WRITE_PLANS)) {
      if (plan.read === undefined) continue;
      const read = TOOLS.find((tool) => tool.name === plan.read?.tool);
      expect(read?.access, `${name} reads with ${plan.read.tool}`).toBe('read');
    }
  });

  it('read with an input the read tool accepts', () => {
    const inputs: Record<string, Record<string, unknown>> = {
      update_client_metadata: { id: ID, if_match: '"x"', name: 'New' },
      update_scope_metadata: { id: ID, if_match: '"x"', description: 'd' },
      update_role_description: { id: ID, if_match: '"x"', description: 'd' },
      update_group_description: { id: ID, if_match: '"x"', description: 'd' },
      update_tenant_text_settings: { if_match: '"x"', display_name: 'Acme' },
      set_message_override: { locale: 'fr', key: 'login.title', message: 'Salut' },
      clear_message_override: { locale: 'fr', key: 'login.title', if_match: '"x"' },
      update_theme_draft: { if_match: '"x"', stylesheet: 'a{}' },
      update_client_theme_draft: { id: ID, if_match: '"x"', stylesheet: 'a{}' },
    };
    for (const [name, input] of Object.entries(inputs)) {
      const step = readStepOf(name, input);
      const read = TOOLS.find((tool) => tool.name === step?.tool);
      expect(read, name).toBeDefined();
      const parsed = read?.input.safeParse(step?.args);
      expect(parsed?.success, `${name}: ${JSON.stringify(parsed)}`).toBe(true);
    }
  });
});

describe('the card of a change', () => {
  it('names only the fields the call changes, after from the call and before from the read', () => {
    const tool = byName('update_client_metadata');
    const input = { id: ID, if_match: '"x"', name: 'Renamed' };
    const names = changedFields(tool, input);
    expect(names).toEqual(['name']);
    expect(afterOf('update_client_metadata', names, input)).toEqual({ name: 'Renamed' });
    expect(
      beforeOf('update_client_metadata', names, input, { name: 'Old', description: 'x' }),
    ).toEqual({ name: 'Old' });
    expect(titleOf('update_client_metadata')).not.toHaveLength(0);
    expect(targetOf('update_client_metadata', input, { name: 'Old' })).toEqual({
      type: 'client',
      id: ID,
      name: 'Old',
    });
  });

  it('has no before for a create and no after for a removal', () => {
    const input = { idempotency_key: 'k', name: 'auditors' };
    expect(beforeOf('create_group', ['name'], input, undefined)).toBeNull();
    expect(afterOf('create_group', ['name'], input)).toEqual({ name: 'auditors' });
    const clear = { locale: 'fr', key: 'login.title', if_match: '"x"' };
    expect(afterOf('clear_message_override', [], clear)).toBeNull();
  });

  it('reads a message override out of a page, and says when the page does not hold it', () => {
    const input = { locale: 'fr', key: 'login.title', message: 'Salut' };
    const page = [
      { locale: 'fr', key: 'a', message: 'x' },
      { locale: 'fr', key: 'login.title', message: 'Bonjour' },
    ];
    expect(beforeOf('set_message_override', ['message'], input, page)).toEqual({
      message: 'Bonjour',
    });
    expect(beforeOf('set_message_override', ['message'], input, [])).toBeNull();
    expect(cursorOf('set_message_override', { next_cursor: 'n' })).toBe('n');
    expect(cursorOf('update_client_metadata', { next_cursor: 'n' })).toBeUndefined();
  });

  it('reads the draft of a theme, else the published one', () => {
    const input = { if_match: '"x"', stylesheet: 'b{}', tokens: { a: 1 } };
    const view = { draft: null, published: { body: { stylesheet: 'a{}', tokens: { a: 0 } } } };
    expect(beforeOf('update_theme_draft', ['tokens', 'stylesheet'], input, view)).toEqual({
      tokens: '{"a":0}',
      stylesheet: 'a{}',
    });
    const drafted = { draft: { stylesheet: 'c{}' }, published: view.published };
    expect(beforeOf('update_theme_draft', ['stylesheet'], input, drafted)).toEqual({
      stylesheet: 'c{}',
    });
  });

  it('names the field whose value would not fit the card whole, and never cuts one', () => {
    const big = { if_match: '"x"', stylesheet: 'a'.repeat(128 * 1024), tokens: { a: 1 } };
    expect(oversizeField(['stylesheet', 'tokens'], big)).toBe('stylesheet');
    const templates = { if_match: '"x"', templates: { 'sign-in': 'b'.repeat(64 * 1024) } };
    expect(oversizeField(['templates'], templates)).toBe('templates');
    const exact = { description: 'x'.repeat(CARD_FIELD_MAX) };
    expect(oversizeField(['description'], exact)).toBeUndefined();
    const after = afterOf('update_role_description', ['description'], exact);
    expect(after?.description).toBe(exact.description);
    expect(oversizeField(['description'], { description: 'x'.repeat(CARD_FIELD_MAX + 1) })).toBe(
      'description',
    );
  });

  it('shows a value that is within the cap whole, with nothing added', () => {
    const after = afterOf('update_role_description', ['description'], { description: 'short' });
    expect(after).toEqual({ description: 'short' });
  });

  it('answers undefined for a read that does not look like the tool’s answer', () => {
    expect(
      beforeOf('update_client_metadata', ['name'], { id: 'c' }, 'not an object'),
    ).toBeUndefined();
  });
});

describe('the tier of every write', () => {
  it('is declared by every plan, and a tier C plan declares the text to type', () => {
    for (const [name, plan] of Object.entries(WRITE_PLANS)) {
      expect(['A', 'B', 'C'], name).toContain(plan.tier);
      expect(confirmTextOf(name, {}, null) === null, name).toBe(plan.tier !== 'C');
    }
  });

  it('is never auto, in either mode, and is B for a removal and A for the rest of the twelve', () => {
    for (const tool of TOOLS.filter((candidate) => candidate.access === 'write')) {
      for (const mode of ['ask', 'act'] as const) {
        const verdict = approvalPolicy({ mode, annotations: tool.annotations, tool: tool.name });
        expect(verdict, `${tool.name} in ${mode}`).not.toBe('auto');
      }
      expect(tierOfTool(tool.name), tool.name).toBe(removesTarget(tool.name) ? 'B' : 'A');
    }
  });

  it('marks as replacing every write that is a PUT, and no other', () => {
    for (const tool of TOOLS.filter((candidate) => candidate.access === 'write')) {
      expect(replacesState(tool.name), tool.name).toBe(tool.routeKey.startsWith('PUT '));
    }
  });
});

describe('what moved since the card', () => {
  const stored = { message: 'old' };
  const page = (message: string) => [{ locale: 'en', key: 'login.title', message }];
  const input = { locale: 'en', key: 'login.title', message: 'new' };

  it('is nothing when the target still reads as the card showed it', () => {
    expect(stateMoved('set_message_override', ['message'], input, stored, page('old'))).toBe(false);
  });

  it('is a change in a field the call names, or a target that appeared or went', () => {
    expect(stateMoved('set_message_override', ['message'], input, stored, page('other'))).toBe(
      true,
    );
    expect(stateMoved('set_message_override', ['message'], input, null, page('old'))).toBe(true);
    expect(stateMoved('set_message_override', ['message'], input, stored, [])).toBe(true);
  });

  it('is nothing for a create that still finds nothing there', () => {
    expect(stateMoved('set_message_override', ['message'], input, null, [])).toBe(false);
  });
});

describe('a set change', () => {
  it('lists what is added and removed, sorted, from the two sides', () => {
    expect(setDiff(['b', 'a', 'c'], ['c', 'd', 'a'])).toEqual({
      kind: 'set',
      added: ['d'],
      removed: ['b'],
    });
    expect(setDiff(['a'], ['a'])).toEqual({ kind: 'set', added: [], removed: [] });
  });

  it('shows forty names a side whole and refuses one more, or a name too long', () => {
    const names = (count: number) => Array.from({ length: count }, (_, i) => `role-${String(i)}`);
    expect(setDiff([], names(SET_DIFF_MAX))).toMatchObject({ kind: 'set' });
    expect(setDiff([], names(SET_DIFF_MAX + 1))).toBe('oversize');
    expect(setDiff(names(SET_DIFF_MAX + 1), [])).toBe('oversize');
    expect(setDiff([], ['x'.repeat(SET_DIFF_NAME_MAX + 1)])).toBe('oversize');
  });

  it('is nothing for a tool that replaces no list', () => {
    expect(diffOf('update_role_description', { id: ID }, {})).toBeUndefined();
  });
});
