import { describe, expect, it } from 'vitest';
import { assistantFromEnv } from '#/assistant-boot';

function run(env: Record<string, string>): {
  lines: string[];
  enabled: boolean;
  kept: Record<string, string | undefined>;
} {
  const lines: string[] = [];
  const { slots, env: kept } = assistantFromEnv(env, (line) => lines.push(line));
  return { lines, enabled: slots !== null, kept };
}

describe('assistantFromEnv', () => {
  it('says once, naming the variable, that the assistant is off when nothing is configured', () => {
    const { lines, enabled } = run({});
    expect(enabled).toBe(false);
    expect(lines).toEqual(['ODUDU_ASSISTANT_MODELS is not set; the assistant is off.']);
  });

  it('names the variable of a slot that cannot be used, without its value', () => {
    const { lines, enabled } = run({ ODUDU_ASSISTANT_MODELS: 'standard=anthropic:m' });
    expect(enabled).toBe(false);
    expect(lines.join('\n')).toContain('ANTHROPIC_API_KEY');
  });

  it('says the assistant is on, with its standard model, and keeps no key', () => {
    const { lines, enabled, kept } = run({
      ODUDU_ASSISTANT_MODELS: 'standard=anthropic:claude-x',
      ANTHROPIC_API_KEY: 'sk-secret',
    });
    expect(enabled).toBe(true);
    expect(lines).toEqual(['The assistant is on: standard slot runs anthropic:claude-x.']);
    expect(JSON.stringify(kept)).not.toContain('sk-secret');
  });
});
