import { describe, expect, it } from 'vitest';
import {
  exportDocumentOf,
  exportedMessageOf,
  exportMarkdownOf,
} from '#/service/conversation-export';
import { createMasker } from '#/service/mask-secrets';

const AT = new Date('2026-11-26T10:00:00.000Z');
const masker = () => createMasker({ emails: false });

describe('exportedMessageOf', () => {
  it('keeps the text of a person and masks a secret in it', () => {
    const exported = exportedMessageOf(
      {
        role: 'user',
        createdAt: AT,
        parts: [{ type: 'text', text: 'my token is Bearer abcdefghijklmnopqrstuvwxyz0123456789' }],
      },
      masker(),
    );
    expect(exported?.role).toBe('user');
    expect(exported?.text).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('names the tools an answer called and never their input or result', () => {
    const exported = exportedMessageOf(
      {
        role: 'assistant',
        createdAt: AT,
        parts: [
          { type: 'text', text: 'You have two clients.' },
          {
            type: 'tool-count_clients',
            toolCallId: 'c1',
            state: 'output-available',
            input: { secret: 'in' },
            output: { n: 2 },
          },
          { type: 'dynamic-tool', toolName: 'list_groups', input: {}, output: {} },
          { type: 'tool-Bad Name', input: {} },
        ],
      },
      masker(),
    );
    expect(exported).toEqual({
      role: 'assistant',
      at: AT.toISOString(),
      text: 'You have two clients.',
      tools: ['count_clients', 'list_groups'],
    });
    expect(JSON.stringify(exported)).not.toContain('"in"');
  });

  it('leaves out the server message and a message with nothing to show', () => {
    expect(exportedMessageOf({ role: 'system', createdAt: AT, parts: [] }, masker())).toBeNull();
    expect(
      exportedMessageOf(
        { role: 'assistant', createdAt: AT, parts: [{ type: 'step-start' }] },
        masker(),
      ),
    ).toBeNull();
    expect(exportedMessageOf({ role: 'user', createdAt: AT, parts: 'x' }, masker())).toBeNull();
  });
});

describe('exportMarkdownOf', () => {
  it('writes the title, each message under who said it and the tools called', () => {
    const doc = exportDocumentOf(
      {
        id: 'c1',
        title: 'Count the clients',
        profile: 'free-chat',
        mode: 'ask',
        created_at: AT.toISOString(),
        last_active_at: AT.toISOString(),
      },
      [
        { role: 'user', at: AT.toISOString(), text: 'How many?', tools: [] },
        { role: 'assistant', at: AT.toISOString(), text: 'Two.', tools: ['count_clients'] },
      ],
      true,
      AT,
    );
    const markdown = exportMarkdownOf(doc);
    expect(markdown).toContain('# Count the clients');
    expect(markdown).toContain('## You (2026-11-26T10:00:00.000Z)');
    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('Tools called: count_clients');
    expect(markdown).toContain('more messages than this export carries');
  });
});
