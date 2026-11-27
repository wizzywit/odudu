export { AssistantGate, type AssistantSlots } from '#/entities/assistant/ui/AssistantGate';
export { useAssistantStatus } from '#/entities/assistant/use-cases/useAssistantStatus';
export { useRefreshAssistantStatus } from '#/entities/assistant/use-cases/useRefreshAssistantStatus';
export { actingInOf, mayUseAssistant } from '#/entities/assistant/services/gate';
export { ASSISTANT_WORDING } from '#/entities/assistant/services/wording';
export {
  MARKDOWN_MAX_CHARS,
  SAFE_NODE_KINDS,
  renderSafeMarkdown,
  type SafeNode,
} from '#/entities/assistant/services/safeMarkdown';
export type { AssistantView } from '#/entities/assistant/services/gate';
export type { AssistantPanelSlot } from '#/entities/assistant/types/panelSlot';
export { useAskAssistant } from '#/entities/assistant/use-cases/useAskAssistant';
export type { AskedTask, TaskRequest } from '#/entities/assistant/types/taskRequest';
