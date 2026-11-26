import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';

// The tag's words, or null where the conversation is in the person's own tenant.
export function actingInText(tenant: string | null): string | null {
  return tenant === null ? null : `Acting in ${tenant}`;
}

// What the mode switch offers. In another tenant the assistant only reads, so
// both choices are drawn and Act is the one that is never available.
export function modeChoices(
  modes: readonly AssistantMode[],
  actingIn: string | null,
): readonly AssistantMode[] {
  return actingIn === null ? modes : ['ask', 'act'];
}
