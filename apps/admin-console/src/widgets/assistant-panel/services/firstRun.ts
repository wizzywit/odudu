import type { FirstRunNotice, NoticeScope } from '#/widgets/assistant-panel/types/firstRun';

const NAMES: Readonly<Record<string, string>> = {
  bedrock: 'Amazon Bedrock',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

// What the person is told before the first message: where their words and the
// tenant data the assistant reads are sent, and who can read the conversation
// afterwards. A self-hosted model is named by its host, which is the operator's.
export function firstRunNotice(
  provider: {
    kind: string;
    host?: string | undefined;
  },
  actingIn: string | null = null,
): FirstRunNotice {
  const sentTo =
    provider.kind === 'openai-compatible' && provider.host !== undefined
      ? `Your messages, and the tenant data the assistant reads to answer them, are sent to a model server at ${provider.host}, which your operator runs.`
      : `Your messages, and the tenant data the assistant reads to answer them, are sent to ${NAMES[provider.kind] ?? provider.kind}.`;
  return {
    sentTo,
    seenBy:
      actingIn === null
        ? 'You can read it again later. People who can read this tenant’s audit trail can read it too, unless an administrator has turned that off in Settings.'
        : 'You can read it again later. People who can read your own tenant’s audit trail can read it too, unless an administrator there has turned that off in Settings.',
    acting:
      actingIn === null
        ? null
        : `Your own tenant pays for this conversation. Administrators of ${actingIn} see that you used the assistant there and which tools it ran, not what you wrote or what it answered.`,
  };
}

// The notice to show, or null once it has been read or while the provider is
// not known.
export function noticeToShow(
  unread: boolean,
  provider: { kind: string; host?: string | undefined } | undefined,
  actingIn: string | null = null,
): FirstRunNotice | null {
  return unread && provider !== undefined ? firstRunNotice(provider, actingIn) : null;
}

export function noticeScopeOf(actingIn: string | null): NoticeScope {
  return actingIn === null ? 'own' : 'other-tenant';
}
