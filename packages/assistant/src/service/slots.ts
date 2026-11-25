export type Slot = 'fast' | 'standard' | 'deep';
export type Provider = 'bedrock' | 'anthropic' | 'openai' | 'openai-compatible';

export interface SlotModel {
  readonly provider: Provider;
  readonly model: string;
  readonly fellBackTo?: Slot;
}

export interface ResolvedSlots {
  readonly standard: SlotModel;
  readonly fast: SlotModel;
  readonly deep: SlotModel;
  readonly warnings: readonly string[];
}

export type AssistantEnv = Readonly<Record<string, string | undefined>>;

export const MODELS_VARIABLE = 'ODUDU_ASSISTANT_MODELS';
export const COMPATIBLE_BASE_URL_VARIABLE = 'ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL';

const SLOTS: readonly Slot[] = ['fast', 'standard', 'deep'];

// Every variable a provider cannot be reached without; the one it may also
// read (the compatible provider's key) is optional and so absent here.
const REQUIRED_VARIABLES: Record<Provider, readonly string[]> = {
  bedrock: ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION'],
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  'openai-compatible': [COMPATIBLE_BASE_URL_VARIABLE],
};

const ENTRY = /^([a-z]+)=([a-z-]+):(.+)$/u;

function isSlot(name: string): name is Slot {
  return SLOTS.some((slot) => slot === name);
}

function isProvider(name: string): name is Provider {
  return Object.hasOwn(REQUIRED_VARIABLES, name);
}

function present(env: AssistantEnv, name: string): boolean {
  return (env[name] ?? '').trim() !== '';
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function parseEntries(
  raw: string,
  warnings: string[],
): Partial<Record<Slot, { provider: Provider; model: string }>> {
  const found: Partial<Record<Slot, { provider: Provider; model: string }>> = {};
  const entries = raw.split(',').map((entry) => entry.trim());
  entries.forEach((entry, index) => {
    if (entry === '') return;
    const where = `${MODELS_VARIABLE} entry ${String(index + 1)}`;
    const match = ENTRY.exec(entry);
    if (match === null) {
      warnings.push(`${where} is not slot=provider:model and is ignored.`);
      return;
    }
    const [, slot = '', provider = '', model = ''] = match;
    if (!isSlot(slot)) {
      warnings.push(`${where} names a slot that is not fast, standard or deep and is ignored.`);
    } else if (!isProvider(provider)) {
      warnings.push(`${where} names a provider that is not supported; slot ${slot} is ignored.`);
    } else if (found[slot] !== undefined) {
      warnings.push(`${where} names slot ${slot} a second time and is ignored.`);
    } else {
      found[slot] = { provider, model: model.trim() };
    }
  });
  return found;
}

function usable(
  slot: Slot,
  choice: { provider: Provider; model: string },
  env: AssistantEnv,
  warnings: string[],
): SlotModel | undefined {
  const missing = REQUIRED_VARIABLES[choice.provider].filter((name) => !present(env, name));
  if (missing.length > 0) {
    warnings.push(`Slot ${slot} is not used: ${missing.join(' and ')} is not set.`);
    return undefined;
  }
  if (
    choice.provider === 'openai-compatible' &&
    !isHttpUrl((env[COMPATIBLE_BASE_URL_VARIABLE] ?? '').trim())
  ) {
    warnings.push(
      `Slot ${slot} is not used: ${COMPATIBLE_BASE_URL_VARIABLE} is not an http(s) URL.`,
    );
    return undefined;
  }
  return { provider: choice.provider, model: choice.model };
}

/**
 * The model each slot runs, from the environment, or `null` when the required
 * standard slot does not resolve. An unset or unusable fast or deep slot runs
 * the standard model and says so in `fellBackTo`. A warning names a variable
 * or an entry's position, never a value.
 */
export function resolveSlots(env: AssistantEnv): ResolvedSlots | null {
  return resolveSlotsReporting(env).slots;
}

/**
 * The same, with the warnings that are otherwise lost when the standard slot
 * does not resolve, which is when an operator most needs to read them.
 */
export function resolveSlotsReporting(env: AssistantEnv): {
  readonly slots: ResolvedSlots | null;
  readonly warnings: readonly string[];
} {
  const warnings: string[] = [];
  const chosen = parseEntries(env[MODELS_VARIABLE] ?? '', warnings);
  const resolved: Partial<Record<Slot, SlotModel>> = {};
  for (const slot of SLOTS) {
    const choice = chosen[slot];
    const model = choice === undefined ? undefined : usable(slot, choice, env, warnings);
    if (model !== undefined) resolved[slot] = model;
  }
  const standard = resolved.standard;
  if (standard === undefined) return { slots: null, warnings };
  const fallback: SlotModel = { ...standard, fellBackTo: 'standard' };
  return {
    slots: {
      standard,
      fast: resolved.fast ?? fallback,
      deep: resolved.deep ?? fallback,
      warnings,
    },
    warnings,
  };
}
