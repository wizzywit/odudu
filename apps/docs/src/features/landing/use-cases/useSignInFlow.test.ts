import { describe, expect, it } from 'vitest';
import { REST_NOTE } from '@site/src/features/landing/services/flowView';
import { useSignInFlow } from '@site/src/features/landing/use-cases/useSignInFlow';
import { resultOf } from '@site/tests/support/hook';

describe('useSignInFlow', () => {
  it('starts at rest, not playing, with the rest note to say', () => {
    const flow = resultOf(useSignInFlow);
    expect(flow.step).toBe(0);
    expect(flow.wantsPlay).toBe(false);
    expect(flow.label).toBe('Play');
    expect(flow.buttons).toHaveLength(7);
    expect(flow.live).toBe(REST_NOTE);
    expect(flow.uid).not.toContain(':');
  });
});
