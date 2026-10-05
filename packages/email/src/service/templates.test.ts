import { describe, expect, it } from 'vitest';
import { renderRequiredActions, renderResetPassword, renderVerifyEmail } from '#/service/templates';

describe('renderVerifyEmail', () => {
  it('puts the action link in both the text and the html body', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/tenants/demo/login-actions/action-token?key=abc',
      tenantDisplayName: 'Demo',
    });
    expect(msg.text).toContain(
      'https://idp.example/tenants/demo/login-actions/action-token?key=abc',
    );
    expect(msg.html).toContain(
      'https://idp.example/tenants/demo/login-actions/action-token?key=abc',
    );
  });

  it('escapes a tenant name that contains markup', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/x',
      tenantDisplayName: '<script>x</script>',
    });
    expect(msg.html).not.toContain('<script>');
  });

  it('addresses the message to the given recipient', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/x',
      tenantDisplayName: 'Demo',
    });
    expect(msg.to).toBe('ada@example.test');
  });
});

describe('renderResetPassword', () => {
  it('puts the action link in both the text and the html body', () => {
    const msg = renderResetPassword({
      to: 'ada@example.test',
      link: 'https://idp.example/tenants/demo/login-actions/action-token?key=xyz',
      tenantDisplayName: 'Demo',
    });
    expect(msg.text).toContain(
      'https://idp.example/tenants/demo/login-actions/action-token?key=xyz',
    );
    expect(msg.html).toContain(
      'https://idp.example/tenants/demo/login-actions/action-token?key=xyz',
    );
  });

  it('escapes a tenant name that contains markup', () => {
    const msg = renderResetPassword({
      to: 'ada@example.test',
      link: 'https://idp.example/x',
      tenantDisplayName: '<script>alert(1)</script>',
    });
    expect(msg.html).not.toContain('<script>');
  });
});

describe('renderRequiredActions', () => {
  it('lists each action, escaped in the html body, and carries the link in both', () => {
    const msg = renderRequiredActions({
      to: 'ada@example.test',
      link: 'https://idp.example/x?key=abc',
      tenantDisplayName: 'Demo <Co>',
      actions: ['Choose a new password', 'Set up <an> app'],
    });
    expect(msg.text).toContain('- Choose a new password\n- Set up <an> app');
    expect(msg.text).toContain('visiting this link:\n\nhttps://idp.example/x?key=abc');
    expect(msg.html).toContain('<li>Set up &lt;an&gt; app</li>');
    expect(msg.html).not.toContain('<Co>');
    expect(msg.html).toContain('https://idp.example/x?key=abc');
  });
});
