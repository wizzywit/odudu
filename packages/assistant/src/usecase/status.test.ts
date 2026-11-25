import { describe, expect, it } from 'vitest';
import { resolveSlots } from '#/service/slots';
import { status } from '#/usecase/status';

function statusOf(env: Record<string, string>): ReturnType<typeof status> {
  return status({ slots: resolveSlots(env), env });
}

describe('status', () => {
  it('is disabled when no standard slot resolves', () => {
    expect(statusOf({})).toEqual({ enabled: false });
    expect(
      statusOf({ ODUDU_ASSISTANT_MODELS: 'fast=anthropic:m', ANTHROPIC_API_KEY: 'k' }),
    ).toEqual({ enabled: false });
  });

  it('reports the model of every slot, an unset one running the standard model', () => {
    const result = statusOf({
      ODUDU_ASSISTANT_MODELS: 'standard=anthropic:claude-sonnet',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(result).toEqual({
      enabled: true,
      slots: { fast: 'claude-sonnet', standard: 'claude-sonnet', deep: 'claude-sonnet' },
      modes: ['ask', 'act'],
      defaultMode: 'ask',
      modelChoices: ['claude-sonnet'],
      provider: { kind: 'anthropic' },
    });
  });

  it('lists each distinct model once, in slot order', () => {
    const result = statusOf({
      ODUDU_ASSISTANT_MODELS: 'deep=anthropic:big,standard=anthropic:mid,fast=anthropic:mid',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(result).toMatchObject({
      slots: { fast: 'mid', standard: 'mid', deep: 'big' },
      modelChoices: ['mid', 'big'],
    });
  });

  it('names the host of a self-hosted endpoint and nothing else of its address', () => {
    const result = statusOf({
      ODUDU_ASSISTANT_MODELS: 'standard=openai-compatible:llama3',
      ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL: 'http://user:secret@gpu.internal:8000/v1?k=1',
    });
    expect(result).toMatchObject({
      provider: { kind: 'openai-compatible', host: 'gpu.internal:8000' },
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|\/v1|k=1/u);
  });

  it('gives no host to any other provider', () => {
    const result = statusOf({
      ODUDU_ASSISTANT_MODELS: 'standard=openai:gpt',
      OPENAI_API_KEY: 'k',
      ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL: 'http://gpu.internal/v1',
    });
    expect(result).toMatchObject({ provider: { kind: 'openai' } });
    expect(result).not.toHaveProperty('provider.host');
  });
});
