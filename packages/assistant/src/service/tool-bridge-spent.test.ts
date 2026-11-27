import type { RegisteredTool } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { toSdkTools } from '#/service/tool-bridge';

const WRITE = {
  name: 'create_role',
  description: 'x',
  access: 'write',
  input: {
    parse: (value: unknown) => value,
    safeParse: (value: unknown) => ({ success: true, data: value }),
  },
} as unknown as RegisteredTool;

async function said(
  outcome: Parameters<NonNullable<Parameters<typeof toSdkTools>[3]>>[2] extends never
    ? never
    : unknown,
) {
  const tools = toSdkTools(
    [WRITE],
    () => Promise.reject(new Error('no read')),
    undefined,
    () => Promise.resolve(outcome as never),
  );
  const execute = (
    tools.create_role as { execute?: (input: unknown, options: unknown) => Promise<string> }
  ).execute;
  return execute?.({}, { toolCallId: 'c1', abortSignal: undefined, messages: [] });
}

describe('what the model reads when a write did not run', () => {
  it('is that nothing was changed when the approval did not cover the call', async () => {
    expect(await said({ kind: 'not_approved' })).toContain('Nothing was changed');
  });

  it('is that it may already have been made when the approval was spent', async () => {
    const text = await said({ kind: 'spent' });
    expect(text).toContain('may already have been made');
    expect(text).not.toContain('Nothing was changed');
  });
});
