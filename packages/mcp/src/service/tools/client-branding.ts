import {
  listThemeVersionsResponseSchema,
  mailBrandingViewSchema,
  previewThemeQuerySchema,
  themePreviewInfoSchema,
  themeViewSchema,
} from '@odudu/contracts/admin';
import { idField, tenantGet, valueTool } from '#/service/read-tool';
import { THEME_LONG_TEXT } from '#/service/tools/branding';

export const clientBrandingTools = [
  valueTool({
    name: 'get_client_theme',
    description:
      "Reads one client's draft and published theme: colours, font, images, stylesheet and page " +
      'templates, which layer supplies each piece, and which parts of the draft differ from the ' +
      "client's published theme. The etag beside data is the draft's, when there is one. A theme " +
      'too large for one result is refused as mcp:result_too_large.',
    routeKey: tenantGet('/clients/:id/theme'),
    capability: 'manage-clients',
    shape: { id: idField('client') },
    pathParams: ['id'],
    response: themeViewSchema,
    etag: true,
    longText: THEME_LONG_TEXT,
  }),
  valueTool({
    name: 'list_client_theme_versions',
    description:
      "Lists one client's published theme version and the archived ones, newest first, at most " +
      '20, without their bodies. Not paged.',
    routeKey: tenantGet('/clients/:id/theme/versions'),
    capability: 'manage-clients',
    shape: { id: idField('client') },
    pathParams: ['id'],
    response: listThemeVersionsResponseSchema,
  }),
  valueTool({
    name: 'get_client_theme_preview_info',
    description:
      'Says what the preview of one page kind in a scheme would show for one client and why: ' +
      "whether the client's draft, its published theme or neither is its own layer, which layer " +
      'the page is shown from, what was left out and whether a template could not be filled. It ' +
      'reads no page.',
    routeKey: tenantGet('/clients/:id/theme/preview/info'),
    capability: 'manage-clients',
    shape: { id: idField('client'), ...previewThemeQuerySchema.shape },
    pathParams: ['id'],
    response: themePreviewInfoSchema,
  }),
  valueTool({
    name: 'get_client_mail_branding',
    description:
      "Reads the colours and logo one client's mail wears, for each scheme, and whether the " +
      "client's theme, the tenant's or Odudu's default supplies each palette.",
    routeKey: tenantGet('/clients/:id/mail/branding'),
    capability: 'manage-clients',
    shape: { id: idField('client') },
    pathParams: ['id'],
    response: mailBrandingViewSchema,
  }),
];
