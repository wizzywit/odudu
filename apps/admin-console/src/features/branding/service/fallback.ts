import type { ThemePreviewInfo } from '@odudu/contracts/admin';
import { capitalise } from '#/shared/service/format';
import type { Read } from '#/shared/service/read';
import { PAGE_KIND_LABELS } from '#/features/branding/service/templates';
import type { ThemeScope } from '#/features/branding/service/scope';

type Fault = ThemePreviewInfo['faults'][number];
type Layer = Fault['layer'];

export interface FallbackNotice {
  lines: string[];
}

export const FALLBACK_TITLE = 'What the preview shows';

export const FALLBACK_FAILED = 'The preview could not be checked for a fallback.';

// What was wrong with a layer or a stylesheet, said after what it was.
export const FALLBACK_REASONS: Readonly<Record<Fault['code'], string>> = {
  invalid_body: 'could not be read',
  image_gone: 'names an image that no longer exists',
  stylesheet_refused: 'has a stylesheet that fails today’s checks, so it is left out',
};

const DEFAULT_LOOK = 'Instrument’s default look';

// The scope's own layer is its draft while there is one; the tenant's layer
// under a client is always a published theme.
function layerNoun(layer: Layer, info: ThemePreviewInfo, scope: ThemeScope): string {
  const own = scope.kind === 'tenant' ? 'tenant' : 'client';
  if (layer !== own) return 'the tenant’s published theme';
  const what = info.from === 'draft' ? 'draft' : 'published theme';
  return scope.kind === 'tenant' ? `the ${what}` : `the client’s ${what}`;
}

function shownNoun(shown: ThemePreviewInfo['shown']): string {
  if (shown === 'default') return DEFAULT_LOOK;
  return shown === 'client' ? 'the client’s theme' : 'the tenant’s theme';
}

function sourceLine(info: ThemePreviewInfo, scope: ThemeScope): string[] {
  if (info.from === 'draft') return [];
  const client = scope.kind === 'client';
  if (info.from === 'published') {
    return [
      client
        ? 'This client has no saved draft, so the preview shows its published theme.'
        : 'There is no saved draft, so the preview shows the published theme.',
    ];
  }
  return [
    client
      ? `This client has no saved draft or published theme, so the preview shows ${shownNoun(info.shown)}.`
      : `There is no saved draft or published theme, so the preview shows ${shownNoun(info.shown)}.`,
  ];
}

function faultLines(info: ThemePreviewInfo, scope: ThemeScope): string[] {
  const own = info.faults.map(
    (fault) =>
      `${capitalise(layerNoun(fault.layer, info, scope))} ${FALLBACK_REASONS[fault.code]}.`,
  );
  const swapped = info.faults.some((fault) => fault.code !== 'stylesheet_refused');
  return swapped ? [...own, `The preview shows ${shownNoun(info.shown)} instead.`] : own;
}

function templateLines(info: ThemePreviewInfo, scope: ThemeScope): string[] {
  const label = PAGE_KIND_LABELS[info.kind];
  const refused = info.refused.map(
    (entry) =>
      `The ${label} template of ${layerNoun(entry.layer, info, scope)} was refused (${entry.codes.join(', ')}), so this page uses the template of the layer below it, or the default one.`,
  );
  return info.unfilled
    ? [...refused, `The ${label} template could not be filled, so the default page is shown.`]
    : refused;
}

// What the preview of a page shows when it is not simply the saved draft,
// and why; null when it is. The server's own account of the same request, so
// it says what the frame shows even though the frame cannot be asked.
export function fallbackNotice(info: ThemePreviewInfo, scope: ThemeScope): FallbackNotice | null {
  const lines = [
    ...sourceLine(info, scope),
    ...faultLines(info, scope),
    ...templateLines(info, scope),
  ];
  return lines.length === 0 ? null : { lines };
}

// The lines to show beside the preview for what the server answered.
export function noticeLines(read: Read<ThemePreviewInfo>, scope: ThemeScope): string[] {
  if (read.status === 'loading') return [];
  if (read.status === 'failed') return [FALLBACK_FAILED];
  return fallbackNotice(read.data, scope)?.lines ?? [];
}
