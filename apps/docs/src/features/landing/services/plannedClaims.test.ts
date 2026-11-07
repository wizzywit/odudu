import { describe, expect, it } from 'vitest';
import { AGENT_ITEMS } from '@site/src/features/landing/services/plannedClaims';

describe('the planned claims', () => {
  it('lists the planned agent items by id', () => {
    expect(AGENT_ITEMS.map((item) => item.id)).toEqual([
      'mcp-access-changing-tools',
      'agent-identity',
    ]);
  });
});
