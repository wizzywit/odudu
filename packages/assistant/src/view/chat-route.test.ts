import { describe, expect, it } from 'vitest';
import { createChat, type ChatDeps } from '#/view/chat-route';

describe('createChat', () => {
  it('refuses approvals that have no secret to sign their requests', () => {
    const deps = { approvals: {} } as unknown as ChatDeps;
    expect(() => createChat(deps)).toThrow(/approval secret/u);
  });

  it('makes a chat that only reads when it is given no approvals', () => {
    expect(createChat({} as ChatDeps)).toBeDefined();
  });
});
