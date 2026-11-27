import { TOOLS, type ToolResult } from '@odudu/mcp';
import { afterEach, describe, expect, it } from 'vitest';
import { WRITE_PLANS } from '#/service/approval-card';
import { movedSinceCard, tierRaisedSinceCard } from '#/usecase/state-guard';

const tool = (name: string) => {
  const found = TOOLS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};

const answer = (data: unknown): ToolResult => ({
  isError: false,
  content: [],
  structuredContent: { data },
});
const failure = (status: number): ToolResult => ({
  isError: true,
  content: [],
  structuredContent: { error: { status } },
});
const page = (message: string) => [{ locale: 'en', key: 'login.title', message }];
const input = { locale: 'en', key: 'login.title', message: 'new' };

describe('a replacing change whose target is read again as the approval is spent', () => {
  const entry = tool('set_message_override');
  const card = { before: { message: 'old' } };

  it('is not moved while the target reads as the card showed it', async () => {
    const read = () => Promise.resolve(answer(page('old')));
    expect(await movedSinceCard(entry, input, card, { read })).toBe(false);
  });

  it('is moved when a field the call names changed', async () => {
    const read = () => Promise.resolve(answer(page('someone else')));
    expect(await movedSinceCard(entry, input, card, { read })).toBe(true);
  });

  it('is moved when the target cannot be read or is gone', async () => {
    expect(
      await movedSinceCard(entry, input, card, { read: () => Promise.resolve(failure(500)) }),
    ).toBe(true);
    expect(
      await movedSinceCard(entry, input, card, { read: () => Promise.resolve(failure(404)) }),
    ).toBe(true);
  });

  it('reads nothing for a change that replaces nothing', async () => {
    let reads = 0;
    const read = () => {
      reads += 1;
      return Promise.resolve(answer({}));
    };
    const amend = tool('update_role_description');
    expect(
      await movedSinceCard(amend, { id: 'r', description: 'd' }, { before: null }, { read }),
    ).toBe(false);
    expect(reads).toBe(0);
  });
});

describe('a stored set change compared as the approval is spent', () => {
  const entry = tool('set_message_override');
  const plan = WRITE_PLANS.set_message_override as unknown as Record<string, unknown>;
  const original = { ...plan };
  afterEach(() => {
    for (const key of Object.keys(plan)) Reflect.deleteProperty(plan, key);
    Object.assign(plan, original);
  });

  it('is moved when the names it adds or removes differ from the card’s', async () => {
    plan.diff = (_input: unknown, data: unknown) => ({
      before: (data as { names: string[] }[])[0]?.names ?? [],
      after: ['a', 'b'],
    });
    const stored = { kind: 'set' as const, added: ['a', 'b'], removed: [] };
    const card = { before: { message: 'old' }, diff: stored };
    const read = (names: string[]) => () =>
      Promise.resolve(answer([{ locale: 'en', key: 'login.title', message: 'old', names }]));
    expect(await movedSinceCard(entry, input, card, { read: read([]) })).toBe(false);
    expect(await movedSinceCard(entry, input, card, { read: read(['b']) })).toBe(true);
  });
});

describe('the tier of an approved change, judged again as it is spent', () => {
  const entry = tool('update_role_description');
  const plan = WRITE_PLANS.update_role_description as unknown as Record<string, unknown>;
  const original = { ...plan };
  afterEach(() => {
    for (const key of Object.keys(plan)) Reflect.deleteProperty(plan, key);
    Object.assign(plan, original);
  });
  const card = { tier: 'C' as const, target: { type: 'role', id: 'r1' } };
  const clean = {
    adminReach: [],
    isOwner: false,
    isBuiltinClient: false,
    rootsConversationGrant: false,
  };

  it('is raised when the target has come to reach an administrator capability', async () => {
    plan.tier = 'C';
    plan.confirmWith = () => 'x';
    const reaches = () => Promise.resolve({ ...clean, adminReach: ['view-audit'] });
    expect(await tierRaisedSinceCard(entry, {}, card, reaches)).toBe(true);
    expect(await tierRaisedSinceCard(entry, {}, card, () => Promise.resolve(clean))).toBe(false);
  });

  it('is judged raised when the facts cannot be read, and never for a tier A card', async () => {
    plan.tier = 'C';
    plan.confirmWith = () => 'x';
    expect(await tierRaisedSinceCard(entry, {}, card, undefined)).toBe(true);
    expect(await tierRaisedSinceCard(entry, {}, { ...card, tier: 'A' }, undefined)).toBe(false);
  });
});
