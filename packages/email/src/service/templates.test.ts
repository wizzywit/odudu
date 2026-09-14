import { describe, expect, it } from 'vitest';
import { renderResetPassword, renderVerifyEmail } from '#/service/templates';

describe('renderVerifyEmail', () => {
  it('puts the action link in both the text and the html body', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/realms/demo/login-actions/action-token?key=abc',
      realmDisplayName: 'Demo',
    });
    expect(msg.text).toContain(
      'https://idp.example/realms/demo/login-actions/action-token?key=abc',
    );
    expect(msg.html).toContain(
      'https://idp.example/realms/demo/login-actions/action-token?key=abc',
    );
  });

  it('escapes a realm name that contains markup', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/x',
      realmDisplayName: '<script>x</script>',
    });
    expect(msg.html).not.toContain('<script>');
  });

  it('addresses the message to the given recipient', () => {
    const msg = renderVerifyEmail({
      to: 'ada@example.test',
      link: 'https://idp.example/x',
      realmDisplayName: 'Demo',
    });
    expect(msg.to).toBe('ada@example.test');
  });
});

describe('renderResetPassword', () => {
  it('puts the action link in both the text and the html body', () => {
    const msg = renderResetPassword({
      to: 'ada@example.test',
      link: 'https://idp.example/realms/demo/login-actions/action-token?key=xyz',
      realmDisplayName: 'Demo',
    });
    expect(msg.text).toContain(
      'https://idp.example/realms/demo/login-actions/action-token?key=xyz',
    );
    expect(msg.html).toContain(
      'https://idp.example/realms/demo/login-actions/action-token?key=xyz',
    );
  });

  it('escapes a realm name that contains markup', () => {
    const msg = renderResetPassword({
      to: 'ada@example.test',
      link: 'https://idp.example/x',
      realmDisplayName: '<script>alert(1)</script>',
    });
    expect(msg.html).not.toContain('<script>');
  });
});
