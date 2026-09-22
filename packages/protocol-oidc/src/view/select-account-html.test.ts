import { describe, expect, it } from 'vitest';
import { renderSelectAccountPage } from '#/view/select-account-html';

const base = {
  realm: 'demo',
  authSessionId: 'a-session',
  accounts: [
    { sessionId: 's1', displayName: 'alice@example.test' },
    { sessionId: 's2', displayName: 'bob@example.test' },
  ],
};

describe('renderSelectAccountPage', () => {
  it('offers one submit per live session, naming the session id', () => {
    const page = renderSelectAccountPage(base);
    expect(page.body).toContain('value="s1"');
    expect(page.body).toContain('value="s2"');
    expect(page.body).toContain('alice@example.test');
  });

  it('offers a way to use another account', () => {
    expect(renderSelectAccountPage(base).body).toContain('name="use_other"');
  });

  it('escapes a display name and never emits the raw form', () => {
    const page = renderSelectAccountPage({
      ...base,
      accounts: [{ sessionId: 's1', displayName: '<script>alert(1)</script>' }],
    });
    expect(page.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.body).not.toContain('<script>alert(1)</script>');
    expect(page.html).not.toContain('<script>alert(1)</script>');
  });

  it('carries no script and declares no frames', () => {
    const page = renderSelectAccountPage(base);
    expect(page.script).toBeNull();
    expect(page.frames).toEqual([]);
  });

  it('returns a title and a body that is not the whole document', () => {
    const page = renderSelectAccountPage(base);
    expect(page.title).toBe('Choose an account');
    expect(page.body).not.toContain('<html');
    expect(page.html).toContain('<html');
  });
});
