import type { GatewayFailure, GatewayResult } from '#/shared/services/result';
import {
  colourProblem,
  DEFAULT_PALETTES,
  withColour,
  type Palette,
  type PaletteKey,
  type Scheme,
} from '#/features/branding/services/palette';
import {
  NO_ISSUES,
  issuesOf,
  PUBLISHED_TOAST,
  warningLines,
  type Issues,
} from '#/features/branding/services/publish';
import type { PreviewChoice } from '#/features/branding/services/preview';
import type { ColourValues } from '#/features/branding/services/values';
import type { FieldError, PublishThemeResponse, ThemeView } from '@odudu/contracts/admin';
import { tabNamed } from '#/shared/services/record';
import { OFFERED_TABS, type OfferedTab } from '#/features/branding/services/tabs';

export function paletteField(scheme: Scheme): 'tokens.light' | 'tokens.dark' {
  return `tokens.${scheme}`;
}

// A scheme is Instrument's own, or a complete palette of the tenant's that
// starts from Instrument's colours.
export function customisedPalette(scheme: Scheme, custom: boolean): Palette | null {
  return custom ? DEFAULT_PALETTES[scheme] : null;
}

export function editedPalette(
  values: ColourValues,
  scheme: Scheme,
  key: PaletteKey,
  text: string,
): Palette {
  return withColour(values[paletteField(scheme)] ?? DEFAULT_PALETTES[scheme], key, text);
}

// The colour fields still not a finished #rrggbb, by palette key.
export function colourProblems(palette: Palette | null): Partial<Record<PaletteKey, string>> {
  if (palette === null) return {};
  return Object.fromEntries(
    (Object.keys(palette) as PaletteKey[])
      .map((key) => [key, colourProblem(palette[key])] as const)
      .filter(([, problem]) => problem !== undefined),
  );
}

export const COLOURS_HOLD = 'Finish each colour as #rrggbb before saving.';

export function coloursHold(values: ColourValues): string | undefined {
  const bad = (['light', 'dark'] as const).some(
    (scheme) => Object.keys(colourProblems(values[paletteField(scheme)])).length > 0,
  );
  return bad ? COLOURS_HOLD : undefined;
}

export interface PublishOutcome {
  issues: Issues;
  // The refusals as the server gave them, with their lines, and the draft
  // they were given for.
  errors: readonly FieldError[];
  atTag: string | null;
  warnings: readonly string[];
  message: string | null;
  // Said as a toast once the publish went through.
  toast: string | null;
}

export const NO_OUTCOME: PublishOutcome = {
  issues: NO_ISSUES,
  errors: [],
  atTag: null,
  warnings: [],
  message: null,
  toast: null,
};

// The last publish answer, as far as it still describes the draft on screen:
// a refusal of one draft says nothing of the draft saved after it.
export function currentOutcome(outcome: PublishOutcome, tag: string): PublishOutcome {
  return outcome.atTag !== null && outcome.atTag !== tag ? NO_OUTCOME : outcome;
}

export function publishOutcomeOf(
  result: GatewayResult<PublishThemeResponse>,
  failureText: (failure: GatewayFailure) => string,
  tag: string,
): PublishOutcome {
  if (result.ok) {
    return {
      issues: NO_ISSUES,
      errors: [],
      atTag: null,
      warnings: warningLines(result.data),
      message: null,
      toast: PUBLISHED_TOAST,
    };
  }
  const errors = result.kind === 'problem' ? result.problem.errors : undefined;
  return {
    issues: issuesOf(errors),
    errors: errors ?? [],
    atTag: tag,
    warnings: [],
    message: failureText(result),
    toast: null,
  };
}

// A publish whose send threw: told as a defect, held at the draft it was for.
export function publishDefected(
  failureText: (failure: GatewayFailure) => string,
  tag: string,
): PublishOutcome {
  return publishOutcomeOf({ ok: false, kind: 'defect' }, failureText, tag);
}

// Says what a publish answer asks to be said, when it asks anything.
export function announcePublish(outcome: PublishOutcome, toast: (text: string) => void): void {
  if (outcome.toast !== null) toast(outcome.toast);
}

export function previewWith(choice: PreviewChoice, change: Partial<PreviewChoice>): PreviewChoice {
  return { ...choice, ...change };
}

// A frame reloads when what it shows may have changed: the published version,
// the draft, or what is asked of it.
export function previewKey(
  view: ThemeView | undefined,
  tag: string | null,
  choice: PreviewChoice,
): string {
  return `${String(view?.published?.version ?? 0)}|${tag ?? ''}|${choice.kind}|${choice.scheme}`;
}

// Runs `select` for a tab this area has, and for no other name.
export function selectOffered(name: string, select: (tab: OfferedTab) => void): void {
  const tab = tabNamed(OFFERED_TABS, name);
  if (tab !== undefined) select(tab);
}
