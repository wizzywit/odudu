import type { PutAssistantSettingsRequest } from '#/pages/settings/types/assistant';
import { booleanOf, numberOf, textOf, type SettingValue } from '#/pages/settings/services/values';

type Values = Readonly<Record<string, SettingValue>>;

// The whole document a save sends: the server replaces every setting, so what
// the section did not change is sent as it was read.
export function assistantRequest(values: Values): PutAssistantSettingsRequest {
  return {
    assistant_enabled: booleanOf(values.assistant_enabled),
    assistant_default_mode: textOf(values.assistant_default_mode) === 'act' ? 'act' : 'ask',
    assistant_mask_emails: booleanOf(values.assistant_mask_emails),
    assistant_trace_retention_days: numberOf(values.assistant_trace_retention_days),
    assistant_auditor_visible: booleanOf(values.assistant_auditor_visible),
    assistant_monthly_tokens_fast: numberOf(values.assistant_monthly_tokens_fast),
    assistant_monthly_tokens_standard: numberOf(values.assistant_monthly_tokens_standard),
    assistant_monthly_tokens_deep: numberOf(values.assistant_monthly_tokens_deep),
    assistant_max_concurrent: numberOf(values.assistant_max_concurrent),
    assistant_max_steps_per_turn: numberOf(values.assistant_max_steps_per_turn),
  };
}
