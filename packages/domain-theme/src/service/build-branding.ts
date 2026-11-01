import { brandingProblems, PAGE_KINDS, type PageKind, type ResolvedBranding } from '@odudu/kernel';
import { type MailBranding } from '@odudu/kernel';
import { type PublishedAsset, type PublishedLayer } from '#/service/record';
import { assetIdsOf, parseThemeBody, type ThemeBody } from '#/service/body';
import { brandingCss, tokensCss } from '#/service/branding-css';
import { buildMailBranding, type LogoSize } from '#/service/mail-branding';
import { assetPath, stylesheetPath } from '#/service/branding-urls';
import { resolvePieces } from '#/service/resolve';
import { checkStylesheet } from '#/service/stylesheet';
import { checkTemplate } from '#/service/template';

const KINDS = Object.keys(PAGE_KINDS) as PageKind[];

export interface BuildInput {
  tenantName: string;
  // The origin pages are served from.
  origin: string;
  // Published layers, most specific first, as stored and so untrusted.
  layers: { name: 'client' | 'tenant'; layer: PublishedLayer }[];
}

export interface TemplateRefused {
  // The layer whose template it was.
  layer: 'client' | 'tenant';
  kind: PageKind;
  reason: string;
}

// Why part of a layer was not used, as a code a caller can word; `problems`
// holds the same facts as log lines.
export interface LayerFault {
  layer: 'client' | 'tenant';
  code: 'invalid_body' | 'image_gone' | 'stylesheet_refused';
}

export interface BuildOutcome {
  // Null when no layer survives: the default theme.
  branding: ResolvedBranding | null;
  // The published versions that were read, `tenant.client`, for a log scope.
  version: string;
  // Why a layer or the whole theme was not used; never user text unquoted.
  problems: string[];
  // Templates dropped for the layer below, or the default.
  refused: TemplateRefused[];
  // The layers the page is drawn from, most specific first; empty when the
  // default look is shown, whatever the reason.
  used: ('client' | 'tenant')[];
  // Layers or stylesheets that were not used, and why.
  faults: LayerFault[];
  // What the hashed stylesheet holds, and the one the page links; empty when
  // the theme sets no css or is not used.
  css: string;
  // The theme as a mail wears it; null with the default theme.
  mail: MailBranding | null;
}

interface Kept {
  name: 'client' | 'tenant';
  // The client's row id when this is a client's layer.
  clientId: string | null;
  body: ThemeBody;
  urls: Map<string, string>;
  sizes: Map<string, LogoSize>;
}

// A layer is used whole or not at all: a body that does not parse, an image
// that is gone, or one of a type no upload produces drops the layer, and
// the layer below answers. A template or stylesheet that fails today's
// checks drops that piece alone.
function keepLayer(
  name: 'client' | 'tenant',
  tenantName: string,
  layer: PublishedLayer,
  report: { problems: string[]; refused: TemplateRefused[]; faults: LayerFault[] },
): Kept | null {
  const { problems, refused, faults } = report;
  const parsed = parseThemeBody(layer.body);
  if (!parsed.ok) {
    problems.push(`${name} theme version ${String(layer.version)} is not a valid body`);
    faults.push({ layer: name, code: 'invalid_body' });
    return null;
  }
  const { body } = parsed;
  const held = new Map<string, PublishedAsset>(layer.assets.map((asset) => [asset.id, asset]));
  const urls = new Map<string, string>();
  const sizes = new Map<string, LogoSize>();
  for (const id of assetIdsOf(body.assets)) {
    const asset = held.get(id);
    const path = asset === undefined ? null : assetPath(tenantName, asset.sha256, asset.mime);
    if (path === null) {
      problems.push(`${name} theme version ${String(layer.version)} names an image that is gone`);
      faults.push({ layer: name, code: 'image_gone' });
      return null;
    }
    urls.set(id, path);
    if (asset !== undefined) sizes.set(id, { width: asset.width, height: asset.height });
  }
  const own = new Set(urls.values());
  const isAssetUrl = (url: string): boolean => own.has(url);
  const accepted: ThemeBody['templates'] = {};
  for (const kind of KINDS) {
    const template = body.templates[kind];
    if (template === undefined) continue;
    const issues = checkTemplate(kind, template, { isAssetUrl });
    if (issues.length === 0) accepted[kind] = template;
    else refused.push({ layer: name, kind, reason: issues.map((issue) => issue.code).join(',') });
  }
  body.templates = accepted;
  if (body.stylesheet !== null && checkStylesheet(body.stylesheet, { isAssetUrl }).length > 0) {
    body.stylesheet = null;
    problems.push(`${name} theme version ${String(layer.version)} has a stylesheet that fails`);
    faults.push({ layer: name, code: 'stylesheet_refused' });
  }
  return { name, clientId: layer.clientId, body, urls, sizes };
}

function logoOf(body: ThemeBody, urls: Map<string, string>): ResolvedBranding['logo'] {
  const { logo, darkLogo } = body.assets;
  const url = logo === undefined ? undefined : urls.get(logo.assetId);
  if (logo === undefined || url === undefined) return null;
  const dark = darkLogo === undefined ? undefined : urls.get(darkLogo.assetId);
  return { url, darkUrl: dark ?? null, alt: logo.alt };
}

// Resolves published layers into what a page is given, or null for the
// default theme. Total for any stored value: whatever is wrong with it is a
// reason in `problems`, never a throw.
export function buildBranding(input: BuildInput): BuildOutcome {
  const problems: string[] = [];
  const refused: TemplateRefused[] = [];
  const faults: LayerFault[] = [];
  let used: ('client' | 'tenant')[] = [];
  const version = (name: string): string =>
    String(input.layers.find((entry) => entry.name === name)?.layer.version ?? 0);
  const outcome = (
    branding: ResolvedBranding | null,
    css = '',
    mail: MailBranding | null = null,
  ): BuildOutcome => ({
    branding,
    version: `${version('tenant')}.${version('client')}`,
    problems,
    refused,
    used: branding === null ? [] : used,
    faults,
    css: branding === null ? '' : css,
    mail: branding === null ? null : mail,
  });
  const kept = input.layers.flatMap((entry) => {
    const layer = keepLayer(entry.name, input.tenantName, entry.layer, {
      problems,
      refused,
      faults,
    });
    return layer === null ? [] : [layer];
  });
  if (kept.length === 0) return outcome(null);
  used = kept.map((layer) => layer.name);

  const body = resolvePieces(kept.map((layer) => layer.body));
  const urls = new Map(kept.flatMap((layer) => [...layer.urls]));
  const sizes = new Map(kept.flatMap((layer) => [...layer.sizes]));
  const clientRowId = kept.find((layer) => layer.clientId !== null)?.clientId ?? null;
  const tokens = tokensCss(body.tokens);
  const favicon = body.assets.favicon;
  const logo = logoOf(body, urls);
  const background = body.assets.background;
  const urlOf = (id: string | undefined): string | null =>
    id === undefined ? null : (urls.get(id) ?? null);
  const css = brandingCss(tokens, body.stylesheet, urlOf(background?.assetId));
  const assetUrls = [
    ...new Set(
      [logo?.url, logo?.darkUrl, urlOf(favicon?.assetId), urlOf(background?.assetId)].filter(
        (url): url is string => typeof url === 'string',
      ),
    ),
  ];
  const branding: ResolvedBranding = {
    origin: input.origin,
    templates: body.templates,
    tokensCss: tokens,
    stylesheetUrl: css === '' ? null : stylesheetPath(input.tenantName, css, clientRowId),
    faviconUrl: urlOf(favicon?.assetId),
    logo,
    assetUrls,
  };
  // A theme that sets nothing is the default look, and keeps the stock policy.
  const empty =
    css === '' && assetUrls.length === 0 && Object.keys(branding.templates).length === 0;
  if (empty) return outcome(null);
  const wrong = brandingProblems(branding);
  if (wrong.length > 0) {
    problems.push(...wrong);
    return outcome(null);
  }
  const mail = buildMailBranding({ body, origin: input.origin, urls, sizes, problems });
  return outcome(branding, css, mail);
}
