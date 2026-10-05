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
  it('lists what remains and links back, escaped, only when there is somewhere to go', () => {
    const page = renderRequiredActionsSucceededPage(
      ['Register a passkey'],
      'https://a.example/?x="1"',
    );
    expect(page.body).toContain('<li>Register a passkey</li>');
    expect(page.body).toContain('href="https://a.example/?x=&quot;1&quot;"');
    expect(renderRequiredActionsSucceededPage([], null).body).not.toContain('<a ');
  });
});
