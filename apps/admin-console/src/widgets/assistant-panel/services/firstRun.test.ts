import { describe, expect, it } from 'vitest';
import { firstRunNotice, noticeToShow } from '#/widgets/assistant-panel/services/firstRun';

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
