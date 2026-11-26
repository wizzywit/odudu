import { describe, expect, it } from 'vitest';
import {
  firstRunNotice,
  noticeScopeOf,
  noticeToShow,
} from '#/widgets/assistant-panel/services/firstRun';

describe('the notice a person reads once', () => {
  it.each([
    ['bedrock', 'Amazon Bedrock'],
    ['anthropic', 'Anthropic'],
    ['openai', 'OpenAI'],
  ])('names %s as the provider that receives what is sent', (kind, name) => {
    const notice = firstRunNotice({ kind });
    expect(notice.sentTo).toContain(name);
    expect(notice.sentTo).toContain('sent to');
  });

  it('names the host of a self-hosted model, and says it is the operator’s', () => {
    const notice = firstRunNotice({ kind: 'openai-compatible', host: 'llm.internal:8443' });
    expect(notice.sentTo).toContain('llm.internal:8443');
    expect(notice.sentTo).toContain('your operator');
  });

  it('says plainly who can read a conversation', () => {
    expect(firstRunNotice({ kind: 'bedrock' }).seenBy).toBe(
      'You can read it again later. People who can read this tenant’s audit trail can read it too, unless an administrator has turned that off in Settings.',
    );
  });

  it('does not invent a name for a provider it does not know', () => {
    expect(firstRunNotice({ kind: 'acme-llm' }).sentTo).toContain('acme-llm');
  });
});

describe('whether the notice is shown', () => {
  it('is shown while unread and the provider is known, and never otherwise', () => {
    expect(noticeToShow(true, { kind: 'bedrock' })?.sentTo).toContain('Amazon Bedrock');
    expect(noticeToShow(false, { kind: 'bedrock' })).toBeNull();
    expect(noticeToShow(true, undefined)).toBeNull();
  });
});

describe('the notice for a conversation in another tenant', () => {
  const notice = firstRunNotice({ kind: 'anthropic' }, 'demo');

  it('says whose allowance pays and that the tenant’s administrators see actions, not text', () => {
    expect(notice.acting).toBe(
      'Your own tenant pays for this conversation. Administrators of demo see that you used the assistant there and which tools it ran, not what you wrote or what it answered.',
    );
  });

  it('places the readers of the conversation in the administrator’s own tenant', () => {
    expect(notice.seenBy).toContain('your own tenant’s audit trail');
  });

  it('has nothing more to say in the administrator’s own tenant', () => {
    expect(firstRunNotice({ kind: 'anthropic' }).acting).toBeNull();
    expect(noticeToShow(true, { kind: 'anthropic' }, 'demo')?.acting).toContain('demo');
  });

  it('is remembered apart from the notice for the own tenant', () => {
    expect(noticeScopeOf('demo')).toBe('other-tenant');
    expect(noticeScopeOf(null)).toBe('own');
  });
});
