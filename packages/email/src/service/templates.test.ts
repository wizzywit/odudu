import { describe, expect, it } from 'vitest';
import { renderResetPassword, renderVerifyEmail } from '#/service/templates';

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
