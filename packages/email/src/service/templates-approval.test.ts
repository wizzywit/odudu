import { describe, expect, it } from 'vitest';
import { ar, en } from '#/service/messages';
import { renderApprovalNotice } from '#/service/templates';

const LINK = 'https://idp.example/tenants/demo/approval/7d0e5c6a-3b0c-4f0e-9d9a-4a8f3c1b2d10';
const NOW = new Date('2026-11-24T09:05:00Z');
const input = {
  to: 'ada@example.test',
  link: LINK,
  agent: 'Calendar Agent',
  tenantDisplayName: 'Demo',
  now: NOW,
};

describe('renderApprovalNotice', () => {
  it('says who is asking, links the request and says to ignore it if it is not recognized', () => {
    const msg = renderApprovalNotice(input);
    expect(msg.to).toBe('ada@example.test');
    expect(msg.subject).toContain('Calendar Agent');
    expect(msg.subject).toContain('Demo');
    expect(msg.text).toContain('Calendar Agent');
    expect(msg.text).toContain(LINK);
    expect(msg.text).toContain(en['approvalNotice.ignore']);
    expect(msg.html).toContain(`href="${LINK}"`);
    expect(msg.html).toContain(en['approvalNotice.ignore']);
  });

  it('carries the approval link and nothing else that looks like a secret', () => {
    const msg = renderApprovalNotice(input);
    const links = (msg.text + msg.html).match(/https?:\/\/[^\s"<]+/gu) ?? [];
    expect(new Set(links)).toEqual(new Set([LINK]));
    expect(msg.text + msg.html).not.toMatch(/token|code=|key=/iu);
  });

  it('keeps the agent name from reaching the header or the markup unescaped', () => {
    const msg = renderApprovalNotice({ ...input, agent: '<b>Evil</b>\r\nBcc: x@evil.test‮' });
    expect(msg.subject).not.toMatch(/[\r\n‮]/u);
    expect(msg.html).not.toContain('<b>Evil</b>');
    expect(msg.html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
    expect(msg.text).not.toContain('‮');
  });

  it('is worded in Arabic, right to left, with every approvalNotice.* sentence translated', () => {
    const keys = Object.keys(en).filter((id) => id.startsWith('approvalNotice.'));
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(Object.hasOwn(ar, key), key).toBe(true);
    const msg = renderApprovalNotice({ ...input, locale: 'ar' });
    expect(msg.html).toContain('dir="rtl"');
    expect(msg.text).toContain(ar['approvalNotice.ignore']);
  });
});
