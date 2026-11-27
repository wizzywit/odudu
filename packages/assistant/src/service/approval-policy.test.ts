import { TOOLS } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { approvalPolicy, ASK_MODE_DENIAL } from '#/service/approval-policy';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };

describe('approvalPolicy', () => {
  it('lets a read run in either mode', () => {
    expect(approvalPolicy({ mode: 'ask', annotations: READ, tool: 'list_clients' })).toBe('auto');
    expect(approvalPolicy({ mode: 'act', annotations: READ, tool: 'list_clients' })).toBe('auto');
  });

  it('denies a write in Ask mode and asks for it in Act mode', () => {
    expect(
      approvalPolicy({ mode: 'ask', annotations: WRITE, tool: 'update_client_metadata' }),
    ).toBe('deny');
    expect(
      approvalPolicy({ mode: 'act', annotations: WRITE, tool: 'update_client_metadata' }),
    ).toBe('ask');
  });

  it('denies a write that is not one of the twelve, in either mode', () => {
    expect(approvalPolicy({ mode: 'act', annotations: WRITE, tool: 'delete_client' })).toBe('deny');
    expect(approvalPolicy({ mode: 'ask', annotations: WRITE, tool: 'delete_client' })).toBe('deny');
  });

  it('gives a reason the model can act on', () => {
    expect(ASK_MODE_DENIAL).toMatch(/Ask mode/u);
    expect(ASK_MODE_DENIAL).toMatch(/Act mode/u);
  });

  it('asks for every tool the catalogue marks as a write', () => {
    for (const tool of TOOLS.filter((entry) => entry.access === 'write')) {
      const verdict = approvalPolicy({
        mode: 'act',
        annotations: tool.annotations,
        tool: tool.name,
      });
      expect(verdict, tool.name).toBe('ask');
    }
  });
});
