import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_PENDING_PER_CONVERSATION,
  ASSISTANT_PENDING_PER_OWNER,
  capRefusal,
} from '#/service/approval-limits';

describe('how many changes may wait at once', () => {
  it('is five to a conversation and ten to a person, well under what P5 allows', () => {
    expect(ASSISTANT_PENDING_PER_CONVERSATION).toBe(5);
    expect(ASSISTANT_PENDING_PER_OWNER).toBe(10);
  });

  it('refuses at the conversation cap first, then the owner cap, else admits', () => {
    expect(capRefusal({ inConversation: 4, forOwner: 9 })).toBeNull();
    expect(capRefusal({ inConversation: 5, forOwner: 5 })).toBe('conversation_cap');
    expect(capRefusal({ inConversation: 2, forOwner: 10 })).toBe('owner_cap');
  });
});
