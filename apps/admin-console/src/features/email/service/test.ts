import { testRecipientSchema } from '@odudu/contracts/admin';
import { writeRefusal } from '#/shared/service/capabilities';
import { writeFailureText } from '#/shared/service/failure';
import type { GatewayResult } from '#/shared/service/result';

export interface TestOutcome {
  tone: 'success' | 'error';
  text: string;
}

export const TEST_RECIPIENT_RULE = 'Enter one email address: no list, no name and no line break.';

export function testBlocked(to: string, configured: boolean): string | undefined {
  if (!configured) {
    return 'Save a relay of this tenant’s own first: the test sends through the saved one.';
  }
  if (to.trim() === '') return 'Enter the address to send to.';
  if (!testRecipientSchema.safeParse(to.trim()).success) return TEST_RECIPIENT_RULE;
  return undefined;
}

// The server's own words for why a send failed, in a sentence that says so.
export function testOutcome(result: GatewayResult<{ sent: boolean }>, to: string): TestOutcome {
  if (result.ok) {
    return result.data.sent
      ? {
          tone: 'success',
          text: `The relay accepted a test message for ${to}. Acceptance is not delivery: look for it in that inbox.`,
        }
      : { tone: 'error', text: `The relay did not take the test message for ${to}.` };
  }
  if (result.kind === 'problem') {
    const { problem } = result;
    const said = problem.detail ?? problem.title;
    const reason = said.endsWith('.') ? said : `${said}.`;
    if (problem.status === 400) {
      return { tone: 'error', text: `Not sent. The server said: ${reason}` };
    }
    if (problem.status === 502) {
      return { tone: 'error', text: `Not sent. The relay failed: ${reason}` };
    }
  }
  return {
    tone: 'error',
    text: writeFailureText(result, {
      name: 'The test message',
      verb: 'sent',
      lookAt: 'the inbox',
      refused: (problem) => writeRefusal(problem, 'manage-tenant'),
    }),
  };
}
