import { assistantModeSchema, type AssistantSettings } from '@odudu/contracts/admin';
import { eq } from 'drizzle-orm';
import { assistantSettings, type AssistantSettingsRecord } from '#/schema/assistant-settings';
import { type AssistantTx } from '#/repository/tx';

function toSettings(row: AssistantSettingsRecord): AssistantSettings {
  return {
    assistant_enabled: row.assistantEnabled,
    assistant_default_mode: assistantModeSchema.parse(row.assistantDefaultMode),
    assistant_mask_emails: row.assistantMaskEmails,
    assistant_trace_retention_days: row.assistantTraceRetentionDays,
    assistant_auditor_visible: row.assistantAuditorVisible,
    assistant_monthly_tokens_fast: row.assistantMonthlyTokensFast,
    assistant_monthly_tokens_standard: row.assistantMonthlyTokensStandard,
    assistant_monthly_tokens_deep: row.assistantMonthlyTokensDeep,
    assistant_max_concurrent: row.assistantMaxConcurrent,
    assistant_max_steps_per_turn: row.assistantMaxStepsPerTurn,
  };
}

function toColumns(settings: AssistantSettings, now: Date) {
  return {
    assistantEnabled: settings.assistant_enabled,
    assistantDefaultMode: settings.assistant_default_mode,
    assistantMaskEmails: settings.assistant_mask_emails,
    assistantTraceRetentionDays: settings.assistant_trace_retention_days,
    assistantAuditorVisible: settings.assistant_auditor_visible,
    assistantMonthlyTokensFast: settings.assistant_monthly_tokens_fast,
    assistantMonthlyTokensStandard: settings.assistant_monthly_tokens_standard,
    assistantMonthlyTokensDeep: settings.assistant_monthly_tokens_deep,
    assistantMaxConcurrent: settings.assistant_max_concurrent,
    assistantMaxStepsPerTurn: settings.assistant_max_steps_per_turn,
    updatedAt: now,
  };
}

export function settingsRepository(tx: AssistantTx) {
  return {
    // Null for a tenant that has never changed a setting: the caller reads
    // the defaults, so a tenant costs no row until it chooses.
    async get(tenantId: string): Promise<AssistantSettings | null> {
      const [row] = await tx
        .select()
        .from(assistantSettings)
        .where(eq(assistantSettings.tenantId, tenantId))
        .limit(1);
      return row === undefined ? null : toSettings(row);
    },

    async put(tenantId: string, settings: AssistantSettings, now: Date): Promise<void> {
      const columns = toColumns(settings, now);
      await tx
        .insert(assistantSettings)
        .values({ tenantId, ...columns })
        .onConflictDoUpdate({ target: assistantSettings.tenantId, set: columns });
    },
  };
}
