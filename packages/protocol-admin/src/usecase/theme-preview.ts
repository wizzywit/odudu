import { type PreviewThemeQuery, type ThemePreviewInfo } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { assetRepository, buildBranding, themeRepository } from '@odudu/domain-theme';
import {
  inlinePreview,
  withBranding,
  type InlinedPreview,
  type PageKind,
  type PreviewRender,
  type RenderedPage,
} from '@odudu/kernel';
import {
  dataUri,
  imageIdsOf,
  layerOf,
  MAX_PREVIEW_BYTES,
  previewInfoView,
  usedImages,
} from '#/service/theme-preview';
import { clientExists, type ThemeTarget } from '#/usecase/theme';

// The page shown when none is asked for.
const DEFAULT_KIND: PageKind = 'sign-in';

export interface ThemePreviewDeps {
  // Every page kind rendered by its own package's renderer with sample values.
  readonly pages: Readonly<Record<PageKind, PreviewRender>>;
}

export type PreviewOutcome =
  | { kind: 'not_found' }
  | { kind: 'too_large'; bytes: number; limit: number }
  | { kind: 'rendered'; inlined: InlinedPreview; fallbacks: PageKind[] };

interface Prepared {
  readonly images: Awaited<ReturnType<ReturnType<typeof assetRepository>['sizes']>>;
  readonly built: ReturnType<typeof buildBranding>;
  readonly from: ThemePreviewInfo['from'];
  readonly kind: PageKind;
  readonly fallbacks: Set<PageKind>;
  readonly unfilled: boolean;
  readonly page: RenderedPage;
}

// The scope as its next publish would be, over what sits below it, and the
// page of it asked for: a client's draft over its tenant's published theme, a
// tenant's over the default. A scope with no draft shows its own published
// theme. The preview and what it says about itself both come from here, so
// they cannot disagree. Five statements whatever the theme names: the client,
// the draft, the published theme, the tenant's, and the images' sizes.
async function prepare(
  tx: TenantScopedDatabase,
  deps: ThemePreviewDeps,
  target: ThemeTarget,
  input: { query: PreviewThemeQuery; origin: string },
): Promise<Prepared | null> {
  if (!(await clientExists(tx, target))) return null;
  const themes = themeRepository(tx);
  const isClient = target.clientRowId !== null;
  const scope = { tenantId: target.tenantId, clientId: target.clientRowId };
  const draft = await themes.draft(scope);
  const own = draft ?? (await themes.published(scope));
  const tenantPublished = isClient
    ? await themes.published({ tenantId: target.tenantId, clientId: null })
    : null;
  const records = [own, tenantPublished].filter((record) => record !== null);

  const images = await assetRepository(tx).sizes(target.tenantId, imageIdsOf(records));
  const layers: { name: 'client' | 'tenant'; layer: ReturnType<typeof layerOf> }[] = [];
  if (own !== null) {
    layers.push({ name: isClient ? 'client' : 'tenant', layer: layerOf(own, images) });
  }
  if (tenantPublished !== null && isClient) {
    layers.push({ name: 'tenant', layer: layerOf(tenantPublished, images) });
  }
  const built = buildBranding({ tenantName: target.tenantName, origin: input.origin, layers });

  const fallbacks = new Set<PageKind>(built.refused.map((entry) => entry.kind));
  const kind = input.query.kind ?? DEFAULT_KIND;
  let unfilled = false;
  const locale = withBranding(
    {
      tag: 'en',
      dir: 'ltr',
      ...(input.query.scheme === undefined ? {} : { theme: input.query.scheme }),
    },
    built.branding,
    (fellBack) => {
      fallbacks.add(fellBack);
      unfilled = true;
    },
  );
  const page = deps.pages[kind](target.tenantName, locale);
  const from = draft === null ? (own === null ? 'none' : 'published') : 'draft';
  return { images, built, from, kind, fallbacks, unfilled, page };
}

export type PreviewInfoOutcome = { kind: 'not_found' } | { kind: 'info'; info: ThemePreviewInfo };

// What the preview of the same request shows and why. At most five statements,
// the preview's own without its image bytes.
export async function previewInfo(
  tx: TenantScopedDatabase,
  deps: ThemePreviewDeps,
  target: ThemeTarget,
  input: { query: PreviewThemeQuery; origin: string },
): Promise<PreviewInfoOutcome> {
  const prepared = await prepare(tx, deps, target, input);
  if (prepared === null) return { kind: 'not_found' };
  return {
    kind: 'info',
    info: previewInfoView({
      kind: prepared.kind,
      from: prepared.from,
      built: prepared.built,
      unfilled: prepared.unfilled,
    }),
  };
}

// The preview itself: the page of the prepared scope with its stylesheet and
// images inlined. Six statements at most, the preparation's and the images'
// bytes once they fit.
export async function previewTheme(
  tx: TenantScopedDatabase,
  deps: ThemePreviewDeps,
  target: ThemeTarget,
  input: { query: PreviewThemeQuery; origin: string },
): Promise<PreviewOutcome> {
  const prepared = await prepare(tx, deps, target, input);
  if (prepared === null) return { kind: 'not_found' };
  const { images, built, fallbacks, page } = prepared;
  const { used, weight } = usedImages(target.tenantName, images, [page.html, built.css]);
  const bytes = weight + built.css.length;
  if (bytes > MAX_PREVIEW_BYTES) return { kind: 'too_large', bytes, limit: MAX_PREVIEW_BYTES };

  const held = await assetRepository(tx).bytesOf(
    target.tenantId,
    used.map((image) => image.id),
  );
  const byId = new Map(held.map((image) => [image.id, image]));
  const uris = new Map<string, string>();
  for (const image of used) {
    const stored = byId.get(image.id);
    if (stored !== undefined) uris.set(image.path, dataUri(stored.mime, stored.bytes));
  }
  return {
    kind: 'rendered',
    fallbacks: [...fallbacks],
    inlined: inlinePreview(page, {
      stylesheetUrl: built.branding?.stylesheetUrl ?? null,
      css: built.css,
      images: uris,
    }),
  };
}
