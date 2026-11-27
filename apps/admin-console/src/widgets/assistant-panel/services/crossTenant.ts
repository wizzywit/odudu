import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';
import { actInNote } from '#/widgets/assistant-panel/services/wording';

// The tag's words, or null where the conversation is in the person's own tenant.
export function actingInText(tenant: string | null): string | null {
  return tenant === null ? null : `Acting in ${tenant}`;
}

// What the switch says under it while the conversation is in Act in another
// tenant, so the tenant a change lands in is named before one is proposed.
export function actNoteOf(tenant: string | null, mode: AssistantMode): string | null {
  return tenant !== null && mode === 'act' ? actInNote(tenant) : null;
}
