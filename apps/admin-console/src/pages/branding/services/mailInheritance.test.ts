import { describe, expect, it } from 'vitest';
import {
  mailInheritsLead,
  paletteRows,
  sourceText,
} from '#/pages/branding/services/mailInheritance';
import { mailBranding } from '#/testing/brandingFixtures';

describe('the mail palette', () => {
  it('lists all nine roles, each with its colour', () => {
    const rows = paletteRows(mailBranding().light.colours);
    expect(rows).toHaveLength(9);
    expect(rows.find((row) => row.role === 'panel')?.colour).toBe('#fafafa');
    expect(rows.find((row) => row.role === 'button_ink')?.label).toBe('Button text');
  });

  it('names who supplies it', () => {
    expect(sourceText('tenant')).toMatch(/published theme/u);
    expect(sourceText('default')).toMatch(/default/u);
    expect(sourceText('client')).toMatch(/client’s published theme/u);
  });
});

describe('what the mail inheritance says about whose mail it shows', () => {
  it('says the tenant’s own until a client is named, then names the client', () => {
    expect(mailInheritsLead(null)).toContain('This shows the tenant’s own');
    expect(mailInheritsLead('Billing')).toContain('a sign-in of Billing sends');
    expect(mailInheritsLead('Billing')).toContain('Never a stylesheet or a template');
  });
});
