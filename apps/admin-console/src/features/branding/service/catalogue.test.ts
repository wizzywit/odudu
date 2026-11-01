import type { MessageCatalogueResponse } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  allMessages,
  MAIL_GROUP_LABEL,
  messageOptions,
  messagesOf,
  messagesForKind,
  templateReference,
} from '#/features/branding/service/catalogue';

const CATALOGUE: MessageCatalogueResponse = {
  sections: [
    {
      kinds: ['sign-in', 'consent'],
      messages: [
        { key: 'login.title', en: 'Sign in' },
        { key: 'shared.cancel', en: 'Cancel' },
      ],
    },
    {
      kinds: ['registration'],
      messages: [
        { key: 'register.title', en: 'Create an account' },
        { key: 'shared.cancel', en: 'Cancel registration' },
      ],
    },
  ],
};

describe('messagesForKind', () => {
  it('is the section that fills the kind, and nothing of another', () => {
    expect(messagesForKind(CATALOGUE, 'consent').map((m) => m.key)).toEqual([
      'login.title',
      'shared.cancel',
    ]);
    expect(messagesForKind(CATALOGUE, 'registration').map((m) => m.key)).toEqual([
      'register.title',
      'shared.cancel',
    ]);
  });

  it('is empty for a kind no section fills', () => {
    expect(messagesForKind(CATALOGUE, 'notice')).toEqual([]);
  });
});

describe('allMessages', () => {
  it('lists every key once, in key order, with the first section’s text', () => {
    expect(allMessages(CATALOGUE)).toEqual([
      { key: 'login.title', text: 'Sign in' },
      { key: 'register.title', text: 'Create an account' },
      { key: 'shared.cancel', text: 'Cancel' },
    ]);
  });
});

describe('the mail section', () => {
  const WITH_MAIL: MessageCatalogueResponse = {
    sections: [
      ...CATALOGUE.sections,
      { kinds: [], messages: [{ key: 'reset.subject', en: 'Reset your {tenant} password' }] },
    ],
  };

  it('is offered to an override, marked as mail, and to no page kind', () => {
    expect(allMessages(WITH_MAIL).find((m) => m.key === 'reset.subject')).toEqual({
      key: 'reset.subject',
      text: 'Reset your {tenant} password',
      group: MAIL_GROUP_LABEL,
    });
    expect(allMessages(WITH_MAIL).find((m) => m.key === 'login.title')?.group).toBeUndefined();
    for (const kind of ['sign-in', 'consent', 'registration', 'notice'] as const) {
      expect(messagesForKind(WITH_MAIL, kind).map((m) => m.key)).not.toContain('reset.subject');
    }
  });

  it('shows its group beside the English text in the picker', () => {
    const [option] = messageOptions(allMessages(WITH_MAIL).filter((m) => m.group !== undefined));
    expect(option?.detail).toBe(`${MAIL_GROUP_LABEL}: Reset your {tenant} password`);
  });
});

describe('templateReference', () => {
  it('is the slot a template writes for a message', () => {
    expect(templateReference('login.title')).toBe('{{t "login.title"}}');
  });
});

describe('messageOptions', () => {
  it('names each option by its key and keeps the whole text, so narrowing can find any word', () => {
    const long = `${'x'.repeat(200)} needle`;
    const options = messageOptions([
      { key: 'a.b', text: 'Sign in' },
      { key: 'c.d', text: long },
    ]);
    expect(options[0]).toEqual({ id: 'a.b', label: 'a.b', detail: 'Sign in' });
    expect(options[1]?.detail).toBe(long);
  });

  it('collapses a text that runs over lines to one line', () => {
    expect(messageOptions([{ key: 'a', text: 'one\n  two' }])[0]?.detail).toBe('one two');
  });
});

describe('messagesOf', () => {
  it('is a kind’s own messages, or every message with no kind', () => {
    expect(messagesOf(CATALOGUE, 'registration').map((m) => m.key)).toEqual([
      'register.title',
      'shared.cancel',
    ]);
    expect(messagesOf(CATALOGUE, null)).toHaveLength(3);
  });
});
