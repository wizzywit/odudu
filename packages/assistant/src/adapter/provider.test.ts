import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLanguageModel } from '#/adapter/provider';
import type { SlotModel } from '#/service/slots';

interface Seen {
  readonly url: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function stubFetch(): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const raw: unknown = init?.body;
      seen.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
      });
      return Promise.resolve(new Response('{}', { status: 500 }));
    }),
  );
  return seen;
}

// A model that answers nothing: the request it makes is what the tests read.
async function requestOf(slot: SlotModel, env: Record<string, string>): Promise<Seen> {
  const seen = stubFetch();
  const model = createLanguageModel(slot, env);
  if (typeof model === 'string') throw new Error('expected a model, not an id');
  await Promise.resolve(
    model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
  ).catch(() => undefined);
  const [first] = seen;
  if (first === undefined) throw new Error('no request was made');
  return first;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createLanguageModel', () => {
  it('asks the openai-compatible server for usage on every streamed response', async () => {
    const seen = await requestOf(
      { provider: 'openai-compatible', model: 'llama3.2' },
      { ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL: 'http://localhost:11434/v1' },
    );
    expect(seen.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(seen.body).toMatchObject({ model: 'llama3.2', stream_options: { include_usage: true } });
    expect(seen.headers.get('authorization')).toBeNull();
  });

  it('sends the openai-compatible key as a bearer token when one is set', async () => {
    const seen = await requestOf(
      { provider: 'openai-compatible', model: 'm' },
      {
        ODUDU_ASSISTANT_OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:8000/v1',
        ODUDU_ASSISTANT_OPENAI_COMPATIBLE_API_KEY: 'compat-key',
      },
    );
    expect(seen.headers.get('authorization')).toBe('Bearer compat-key');
  });

  it('sends the Anthropic key and the pinned model', async () => {
    const seen = await requestOf(
      { provider: 'anthropic', model: 'claude-pinned' },
      { ANTHROPIC_API_KEY: 'anthropic-key' },
    );
    expect(seen.url).toContain('api.anthropic.com');
    expect(seen.headers.get('x-api-key')).toBe('anthropic-key');
    expect(seen.body).toMatchObject({ model: 'claude-pinned' });
  });

  it('sends the OpenAI key', async () => {
    const seen = await requestOf(
      { provider: 'openai', model: 'gpt-pinned' },
      { OPENAI_API_KEY: 'openai-key' },
    );
    expect(seen.url).toContain('api.openai.com');
    expect(seen.headers.get('authorization')).toBe('Bearer openai-key');
  });

  it('calls Bedrock in the configured region with the bearer key', async () => {
    const seen = await requestOf(
      { provider: 'bedrock', model: 'eu.anthropic.claude-pinned-v1:0' },
      { AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key', AWS_REGION: 'eu-west-1' },
    );
    expect(seen.url).toContain('bedrock-runtime.eu-west-1.amazonaws.com');
    expect(seen.headers.get('authorization')).toBe('Bearer bedrock-key');
  });

  it('refuses a provider whose variable is missing, naming the variable and no value', () => {
    const withoutRegion = () =>
      createLanguageModel(
        { provider: 'bedrock', model: 'm' },
        { AWS_BEARER_TOKEN_BEDROCK: 'secret-value' },
      );
    expect(withoutRegion).toThrow(/AWS_REGION/u);
    expect(withoutRegion).not.toThrow(/secret-value/u);
  });
});
