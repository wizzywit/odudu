import { explainSlots, type StatusDeps } from '@odudu/assistant';

// The one variable the status route reads again after start; the provider
// keys are used where a model is called and are not carried here.
const KEPT = 'ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL';

/**
 * The assistant's models, resolved once at start from the environment, with
 * one line for each thing an operator needs to hear: a slot that cannot be
 * used, and whether the assistant is on. A line names a variable, never a value.
 */
export function assistantFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  say: (line: string) => void,
): StatusDeps {
  const { slots, warnings } = explainSlots(env);
  for (const warning of warnings) say(warning);
  if (slots !== null) {
    say(
      `The assistant is on: standard slot runs ${slots.standard.provider}:${slots.standard.model}.`,
    );
  }
  return { slots, env: { [KEPT]: env[KEPT] } };
}
