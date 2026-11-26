import { CARD_FIELD_MAX } from '@odudu/contracts/admin';
import { TOOLS } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import {
  afterOf,
  oversizeField,
  beforeOf,
  changedFields,
  cursorOf,
  readStepOf,
  targetOf,
  titleOf,
  WRITE_PLANS,
  writeToolNames,
} from '#/service/approval-card';

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
