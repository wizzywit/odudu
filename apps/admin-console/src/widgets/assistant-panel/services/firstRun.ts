import type { FirstRunNotice } from '#/widgets/assistant-panel/types/firstRun';

const NAMES: Readonly<Record<string, string>> = {
  bedrock: 'Amazon Bedrock',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

// What the person is told before the first message: where their words and the
// tenant data the assistant reads are sent, and who can read the conversation
// afterwards. A self-hosted model is named by its host, which is the operator's.
export function firstRunNotice(provider: {
  kind: string;
  host?: string | undefined;
}): FirstRunNotice {
  const sentTo =
    provider.kind === 'openai-compatible' && provider.host !== undefined
      ? `Your messages, and the tenant data the assistant reads to answer them, are sent to a model server at ${provider.host}, which your operator runs.`
      : `Your messages, and the tenant data the assistant reads to answer them, are sent to ${NAMES[provider.kind] ?? provider.kind}.`;
  return {
    sentTo,
    seenBy:
      'You can read it again later. People who can read this tenant’s audit trail can read it too, unless an administrator has turned that off in Settings.',
  };
}

// The notice to show, or null once it has been read or while the provider is
// not known.
export function noticeToShow(
  unread: boolean,
  provider: { kind: string; host?: string | undefined } | undefined,
): FirstRunNotice | null {
  return unread && provider !== undefined ? firstRunNotice(provider) : null;
}
