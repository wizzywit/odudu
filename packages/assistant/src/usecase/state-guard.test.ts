import { TOOLS, type ToolResult } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { movedSinceCard } from '#/usecase/state-guard';

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
