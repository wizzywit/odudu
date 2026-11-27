import { describe, expect, it } from 'vitest';
import { explainSlots, MAX_WARNINGS, resolveSlots } from '#/service/slots';

const BEDROCK_ENV = { AWS_BEARER_TOKEN_BEDROCK: 'bk-secret', AWS_REGION: 'eu-west-1' };

describe('resolveSlots', () => {
  it('gives fast and deep the standard model when only standard is set', () => {
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: 'standard=bedrock:eu.anthropic.claude-sonnet-5-5-v1:0',
      ...BEDROCK_ENV,
    });
    expect(slots?.standard).toEqual({
      provider: 'bedrock',
      model: 'eu.anthropic.claude-sonnet-5-5-v1:0',
    });
    expect(slots?.fast).toEqual({ ...slots?.standard, fellBackTo: 'standard' });
    expect(slots?.deep).toEqual({ ...slots?.standard, fellBackTo: 'standard' });
    expect(slots?.warnings).toEqual([]);
  });

  it('resolves each slot to its own provider and model', () => {
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: 'fast=openai:m1, standard=anthropic:m2 ,deep=bedrock:m3',
      OPENAI_API_KEY: 'sk-one',
      ANTHROPIC_API_KEY: 'sk-two',
      ...BEDROCK_ENV,
    });
    expect(slots).toMatchObject({
      fast: { provider: 'openai', model: 'm1' },
      standard: { provider: 'anthropic', model: 'm2' },
      deep: { provider: 'bedrock', model: 'm3' },
      warnings: [],
    });
    expect(slots?.fast.fellBackTo).toBeUndefined();
  });

  it('drops a slot whose key variable is missing and names the variable, not a value', () => {
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: 'standard=anthropic:m2,fast=openai:m1,deep=bedrock:m3',
      ANTHROPIC_API_KEY: 'sk-two',
      AWS_BEARER_TOKEN_BEDROCK: 'bk-secret',
    });
    expect(slots?.fast).toEqual({ provider: 'anthropic', model: 'm2', fellBackTo: 'standard' });
    expect(slots?.deep).toEqual({ provider: 'anthropic', model: 'm2', fellBackTo: 'standard' });
    expect(slots?.warnings).toHaveLength(2);
    expect(slots?.warnings.join('\n')).toContain('OPENAI_API_KEY');
    expect(slots?.warnings.join('\n')).toContain('AWS_REGION');
    expect(slots?.warnings.join('\n')).not.toMatch(/sk-two|bk-secret/);
  });

  it('treats a blank variable as missing', () => {
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: 'standard=anthropic:m2,fast=openai:m1',
      ANTHROPIC_API_KEY: 'sk-two',
      OPENAI_API_KEY: '   ',
    });
    expect(slots?.fast.fellBackTo).toBe('standard');
    expect(slots?.warnings.join('\n')).toContain('OPENAI_API_KEY');
  });

  it('returns null when standard is not set or does not resolve', () => {
    expect(resolveSlots({})).toBeNull();
    expect(resolveSlots({ ODUDU_ASSISTANT_MODELS: '' })).toBeNull();
    expect(
      resolveSlots({ ODUDU_ASSISTANT_MODELS: 'fast=anthropic:m', ANTHROPIC_API_KEY: 'k' }),
    ).toBeNull();
    expect(resolveSlots({ ODUDU_ASSISTANT_MODELS: 'standard=anthropic:m' })).toBeNull();
  });

  it('drops an openai-compatible slot without a base URL', () => {
    const env = { ODUDU_ASSISTANT_MODELS: 'standard=anthropic:a,fast=openai-compatible:small' };
    const slots = resolveSlots({ ...env, ANTHROPIC_API_KEY: 'k' });
    expect(slots?.fast.fellBackTo).toBe('standard');
    expect(slots?.warnings.join('\n')).toContain('ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL');
  });

  it('drops an openai-compatible slot whose base URL is not an http(s) URL, without echoing it', () => {
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: 'standard=anthropic:a,fast=openai-compatible:small',
      ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL: 'ftp://user:hunter2@host/v1',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(slots?.fast.fellBackTo).toBe('standard');
    expect(slots?.warnings.join('\n')).not.toContain('hunter2');
  });

  it('accepts a loopback or private base URL and needs no key for it', () => {
    for (const baseUrl of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:8000/v1',
      'http://10.0.0.5/v1',
    ]) {
      const slots = resolveSlots({
        ODUDU_ASSISTANT_MODELS: 'standard=openai-compatible:llama3.2:latest',
        ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL: baseUrl,
      });
      expect(slots?.standard).toEqual({ provider: 'openai-compatible', model: 'llama3.2:latest' });
      expect(slots?.warnings).toEqual([]);
    }
  });

  it('turns a malformed entry into a warning and keeps the others', () => {
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS:
        'standard=anthropic:m2,nonsense,fast=,medium=openai:x,deep=cohere:y,deep=anthropic:',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(slots?.standard.model).toBe('m2');
    expect(slots?.fast.fellBackTo).toBe('standard');
    expect(slots?.deep.fellBackTo).toBe('standard');
    expect(slots?.warnings).toHaveLength(5);
    expect(slots?.warnings.join('\n')).not.toContain('nonsense');
  });

  it('keeps the first entry when a slot is named twice', () => {
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: 'standard=anthropic:first,standard=anthropic:second',
      ANTHROPIC_API_KEY: 'k',
    });
    expect(slots?.standard.model).toBe('first');
    expect(slots?.warnings).toHaveLength(1);
  });
});

describe('explainSlots', () => {
  it('names the missing variable when standard is set but unusable', () => {
    const explained = explainSlots({ ODUDU_ASSISTANT_MODELS: 'standard=anthropic:m' });
    expect(explained.slots).toBeNull();
    expect(explained.warnings.join('\n')).toContain('ANTHROPIC_API_KEY');
  });

  it('says nothing is configured when the variable is unset', () => {
    const explained = explainSlots({});
    expect(explained.slots).toBeNull();
    expect(explained.warnings.join('\n')).toContain('ODUDU_ASSISTANT_MODELS');
  });

  it('agrees with resolveSlots on the slots and carries the same warnings', () => {
    const env = { ODUDU_ASSISTANT_MODELS: 'standard=anthropic:m,junk', ANTHROPIC_API_KEY: 'k' };
    const explained = explainSlots(env);
    expect(explained.slots).toEqual(resolveSlots(env));
    expect(explained.warnings).toEqual(explained.slots?.warnings);
    expect(explained.warnings).toHaveLength(1);
  });
});

describe('the warning bound', () => {
  it('keeps the first warnings and counts the rest in one final line', () => {
    const junk = Array.from({ length: MAX_WARNINGS + 7 }, (_, i) => `junk${String(i)}`).join(',');
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: `standard=anthropic:m,${junk}`,
      ANTHROPIC_API_KEY: 'k',
    });
    expect(slots?.warnings).toHaveLength(MAX_WARNINGS + 1);
    expect(slots?.warnings.at(-1)).toBe('7 further entries ignored.');
    expect(slots?.warnings[0]).toContain('entry 2');
  });

  it('adds no final line at the bound', () => {
    const junk = Array.from({ length: MAX_WARNINGS }, (_, i) => `junk${String(i)}`).join(',');
    const slots = resolveSlots({
      ODUDU_ASSISTANT_MODELS: `standard=anthropic:m,${junk}`,
      ANTHROPIC_API_KEY: 'k',
    });
    expect(slots?.warnings).toHaveLength(MAX_WARNINGS);
  });
});
