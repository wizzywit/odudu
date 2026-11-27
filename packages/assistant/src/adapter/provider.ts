import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { COMPATIBLE_BASE_URL_VARIABLE, type AssistantEnv, type SlotModel } from '#/service/slots';

export const COMPATIBLE_API_KEY_VARIABLE = 'ODUDU_ASSISTANT_OPENAI_COMPATIBLE_API_KEY';

function required(env: AssistantEnv, name: string): string {
  const value = (env[name] ?? '').trim();
  if (value === '') throw new Error(`${name} is not set`);
  return value;
}

function optional(env: AssistantEnv, name: string): string | undefined {
  const value = (env[name] ?? '').trim();
  return value === '' ? undefined : value;
}

function keyOption(apiKey: string | undefined): { apiKey?: string } {
  return apiKey === undefined ? {} : { apiKey };
}

/**
 * The model a slot runs. This file is the one place that names a provider
 * package, and each key is read from `env` here and handed to the provider,
 * never put in a message, a log or an option another layer can read.
 */
export function createLanguageModel(slot: SlotModel, env: AssistantEnv): LanguageModel {
  switch (slot.provider) {
    case 'bedrock':
      return createAmazonBedrock({
        apiKey: required(env, 'AWS_BEARER_TOKEN_BEDROCK'),
        region: required(env, 'AWS_REGION'),
      })(slot.model);
    case 'anthropic':
      return createAnthropic({ apiKey: required(env, 'ANTHROPIC_API_KEY') })(slot.model);
    case 'openai':
      return createOpenAI({ apiKey: required(env, 'OPENAI_API_KEY') })(slot.model);
    case 'openai-compatible':
      // Without usage on streamed responses a token budget has nothing to count.
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: required(env, COMPATIBLE_BASE_URL_VARIABLE),
        ...keyOption(optional(env, COMPATIBLE_API_KEY_VARIABLE)),
        includeUsage: true,
      }).chatModel(slot.model);
  }
}

const KEY_VARIABLES = [
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  COMPATIBLE_API_KEY_VARIABLE,
];

/** The provider keys `env` holds, so the code that records a turn can keep them out of it. */
export function providerSecrets(env: AssistantEnv): string[] {
  return KEY_VARIABLES.flatMap((name) => {
    const value = optional(env, name);
    return value === undefined ? [] : [value];
  });
}
