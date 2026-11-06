import {
  listThemeVersionsResponseSchema,
  mailBrandingViewSchema,
  themePreviewInfoSchema,
  themeViewSchema,
} from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { clientBrandingTools } from '#/service/tools/client-branding';
import { describeReadTool } from '#/testing/conformance';
import { exampleOf } from '#/testing/example-of';
import { respondingWith } from '#/testing/fake-caller';

const ID = '0192a0a0-0000-7000-8000-000000000001';
const C = '/admin/tenants/:tenant/clients/:id';
const KIB = 1024;

function named(name: string) {
  const found = clientBrandingTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('client branding tools', () => {
  describeReadTool({
    tool: named('get_client_theme'),
    response: themeViewSchema,
    pattern: `${C}/theme`,
    input: { id: ID },
    params: { id: ID },
    etag: true,
  });
  describeReadTool({
    tool: named('list_client_theme_versions'),
    response: listThemeVersionsResponseSchema,
    pattern: `${C}/theme/versions`,
    input: { id: ID },
    params: { id: ID },
  });
  describeReadTool({
    tool: named('get_client_theme_preview_info'),
    response: themePreviewInfoSchema,
    pattern: `${C}/theme/preview/info`,
    input: { id: ID },
    params: { id: ID },
  });
  describeReadTool({
    tool: named('get_client_mail_branding'),
    response: mailBrandingViewSchema,
    pattern: `${C}/mail/branding`,
    input: { id: ID },
    params: { id: ID },
    text: ['logo', 'alt'],
  });

  it('are manage-clients reads of one client', () => {
    for (const tool of clientBrandingTools) {
      expect(tool.capability, tool.name).toBe('manage-clients');
      expect(tool.access, tool.name).toBe('read');
    }
  });

  it('returns a client template of 60 KiB whole', async () => {
    const themed = (size: number) => {
      const body = {
        tokens: {},
        stylesheet: null,
        templates: { consent: 'c'.repeat(size) },
        assets: {},
      };
      return { ...(exampleOf(themeViewSchema) as object), draft: body, published: null };
    };
    const whole = await callTool(named('get_client_theme'), respondingWith(themed(60 * KIB)), {
      id: ID,
    });
    expect(JSON.stringify(whole.structuredContent)).toContain('c'.repeat(60 * KIB));
    expect(whole.structuredContent).not.toHaveProperty('truncated');
  });

  it('refuses an id that is not a UUID before any call', async () => {
    const caller = respondingWith(exampleOf(themeViewSchema));
    const result = await callTool(named('get_client_theme'), caller, { id: '../tenants' });
    expect(result.isError).toBe(true);
    expect(caller.requests).toHaveLength(0);
  });
});
