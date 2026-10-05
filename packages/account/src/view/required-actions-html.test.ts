import { describe, expect, it } from 'vitest';
import {
  renderRequiredActionsForm,
  renderRequiredActionsSucceededPage,
} from '#/view/required-actions-html';

describe('renderRequiredActionsForm', () => {
  it('lists each action escaped, and asks for a password only when told to', () => {
    const asks = renderRequiredActionsForm('acme', 'k"ey', ['Set <up>'], true);
    expect(asks.body).toContain('<li>Set &lt;up&gt;</li>');
    expect(asks.body).toContain('value="k&quot;ey"');
    expect(asks.body).toContain('name="password"');
    expect(asks.script).toBeNull();
    expect(renderRequiredActionsForm('acme', 'key', ['x'], false).body).not.toContain('password');
  });
});

describe('renderRequiredActionsSucceededPage', () => {
  it('lists what remains, escaped, and sends the user to sign in rather than to a callback', () => {
    const page = renderRequiredActionsSucceededPage(['Register <a> passkey']);
    expect(page.body).toContain('<li>Register &lt;a&gt; passkey</li>');
    expect(page.body).toContain('Sign in to the application to finish:');
    expect(page.body).not.toContain('<a ');
    expect(page.body).not.toContain('href');
  });

  it('says it can be closed once nothing remains', () => {
    const page = renderRequiredActionsSucceededPage([]);
    expect(page.body).toContain('close this page and sign in to the application');
    expect(page.body).not.toContain('<ul>');
  });
});
