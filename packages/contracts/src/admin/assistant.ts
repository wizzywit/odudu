import { z } from 'zod';

export const ASSISTANT_MODES = ['ask', 'act'] as const;
export const assistantModeSchema = z.enum(ASSISTANT_MODES);
export type AssistantMode = z.infer<typeof assistantModeSchema>;

// The model each slot runs, as the provider names it. `host` is the address of
// a self-hosted endpoint and is present only for `openai-compatible`.
export const assistantStatusSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    slots: z.object({ fast: z.string(), standard: z.string(), deep: z.string() }),
    modes: z.array(assistantModeSchema),
    defaultMode: assistantModeSchema,
    modelChoices: z.array(z.string()),
    provider: z.object({ kind: z.string(), host: z.string().optional() }),
  }),
]);
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;
