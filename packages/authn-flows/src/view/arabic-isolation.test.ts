import { describe, expect, it } from 'vitest';
import { ar } from '#/view/messages.ar';
import { renderRequiredActionPage } from '#/view/required-action-html';
import { token } from '#/view/messages';
import { ARABIC } from '@odudu/testkit/i18n';

const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

describe('a page in Arabic isolates what somebody else wrote', () => {
  it('the pending action on the required-action page', () => {
    const page = renderRequiredActionPage('configure<x>' as never, null, ARABIC);
    expect(page.body).toContain('(<bdi>configure&lt;x&gt;</bdi>)');
  });

  it('a secret or code keeps its own left-to-right order', () => {
    expect(token('GEZD-GNBV')).toBe('<bdi dir="ltr"><code>GEZD-GNBV</code></bdi>');
  });

  it('the passkey failure reason, which the page script fills in', () => {
    expect(ar['passkey.failed']).toContain(`${FSI}{reason}${PDI}`);
  });
});
