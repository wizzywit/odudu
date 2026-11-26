import { TOOLS } from '@odudu/mcp';
import { describe, expect, it } from 'vitest';
import { inputUpperBound } from '#/service/estimate';
import { FREE_CHAT } from '#/service/profile';
import {
  MAX_REQUEST_TOKENS,
  requestParts,
  reservationTokens,
  toolDefinitionsText,
} from '#/service/request-size';
import { buildSystemPrompt } from '#/service/system-prompt';
import { toSdkTools } from '#/service/tool-bridge';
import { assistantTools } from '#/service/tool-set';

// The figures the operating page, the settings page and the console help quote.
// They are computed here from the real tool set, so a change to it fails this
// test until the pages are corrected.
describe('the reservation figures the documentation quotes', () => {
  it('stay inside the quoted ranges for the real tool set', async () => {
    const tools = toSdkTools(assistantTools(TOOLS), () => Promise.reject(new Error('unused')));
    const prompt = buildSystemPrompt(FREE_CHAT, 'Acme');
    const { fixed } = requestParts(
      [
        { role: 'system', content: prompt.static },
        { role: 'system', content: prompt.tenant },
      ],
      [],
      await toolDefinitionsText(tools),
    );
    const fixedBytes = inputUpperBound(fixed);
    const least = reservationTokens({ fixedBytes, messagesBytes: 100 });
    const most = reservationTokens({ fixedBytes, messagesBytes: MAX_REQUEST_TOKENS - fixedBytes });

    expect(least).toBeGreaterThan(35_000);
    expect(least).toBeLessThan(39_000);
    expect(most).toBeGreaterThan(130_000);
    expect(most).toBeLessThan(135_000);
    // A quarter of the month must hold one reservation: below four times the least,
    // none is admitted, and below four times the most some are refused.
    expect(4 * least).toBeGreaterThan(140_000);
    expect(4 * least).toBeLessThan(156_000);
    expect(4 * most).toBeGreaterThan(520_000);
    expect(4 * most).toBeLessThan(540_000);
  });
});
