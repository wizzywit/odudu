import type { GatewayFailure, GatewayResult } from '#/shared/service/result';
import { reportFailure } from '#/shared/service/settled';
import {
  altEdited,
  slotNames,
  logoOf,
  uploadRefusal,
  uploadFailureText,
  UPLOAD_FAULT,
  UPLOAD_LOST,
} from '#/features/branding/service/assets';
import {
  colourProblem,
  DEFAULT_PALETTES,
  withColour,
  type Palette,
  type PaletteKey,
  type Scheme,
} from '#/features/branding/service/palette';
import {
  NO_ISSUES,
  issuesOf,
  PUBLISHED_TOAST,
  warningLines,
  type Issues,
} from '#/features/branding/service/publish';
import type { PreviewChoice } from '#/features/branding/service/preview';
import {
  type ColourValues,
  type ImageSlot,
  type ImageValues,
  type Logo,
  type Plain,
} from '#/features/branding/service/values';
import type {
  FieldError,
  PublishThemeResponse,
  ThemeAsset,
  ThemeView,
} from '@odudu/contracts/admin';
import { tabNamed } from '#/shared/service/record';
import { OFFERED_TABS, type OfferedTab } from '#/features/branding/service/tabs';

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

// What an uploaded image fills its slot with: a logo keeps the alt text it
// had, and starts without one.
export function imageAfterUpload(
  slot: ImageSlot,
  assetId: string,
  values: ImageValues,
): Logo | Plain {
  if (slot === 'logo') return logoOf(assetId, values['assets.logo']);
  if (slot === 'darkLogo') return logoOf(assetId, values['assets.darkLogo']);
  return { assetId };
}

export interface SlotState {
  busy: boolean;
  error: string | null;
}

export type SlotStates = Readonly<Record<ImageSlot, SlotState>>;

const QUIET: SlotState = { busy: false, error: null };

export const IDLE_SLOTS: SlotStates = {
  logo: QUIET,
  darkLogo: QUIET,
  favicon: QUIET,
  background: QUIET,
};

export function slotBusy(slots: SlotStates, slot: ImageSlot): SlotStates {
  return { ...slots, [slot]: { busy: true, error: null } };
}

export function slotFailed(slots: SlotStates, slot: ImageSlot, error: string): SlotStates {
  return { ...slots, [slot]: { busy: false, error } };
}

export function slotDone(slots: SlotStates, slot: ImageSlot): SlotStates {
  return { ...slots, [slot]: QUIET };
}

// What a failed upload says, in the console's words.
export function uploadFailureOf(slot: ImageSlot, failure: GatewayFailure): string {
  switch (failure.kind) {
    case 'problem':
      return uploadFailureText(slot, failure.problem);
    case 'network':
      return UPLOAD_LOST;
    default:
      return UPLOAD_FAULT;
  }
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

export interface UploadStart {
  // Takes the change to the slots as a function of the slots at the time it runs.
  show: (next: (was: SlotStates) => SlotStates) => void;
  send: () => void;
}

// Marks the slot busy and sends the file, or fails the slot in place when the
// file is refused here, before anything is sent.
export function startUpload(
  slot: ImageSlot,
  file: { type: string; size: number },
  to: UploadStart,
): void {
  const refused = uploadRefusal(slot, file);
  to.show((was) => (refused === null ? slotBusy(was, slot) : slotFailed(was, slot, refused)));
  if (refused === null) to.send();
}

// The slot once its upload has answered.
export function slotAfterUpload(
  slots: SlotStates,
  slot: ImageSlot,
  result: GatewayResult<ThemeAsset>,
): SlotStates {
  return result.ok ? slotDone(slots, slot) : slotFailed(slots, slot, uploadFailureOf(slot, result));
}

// What an answered upload puts in its slot, nothing when it was refused.
export function uploadedImage(
  slot: ImageSlot,
  result: GatewayResult<ThemeAsset>,
  values: ImageValues,
): Logo | Plain | null {
  return result.ok ? imageAfterUpload(slot, result.data.id, values) : null;
}

export interface UploadAnswer {
  show: (next: (was: SlotStates) => SlotStates) => void;
  edit: (slot: ImageSlot, image: Logo | Plain | null) => void;
  report: (failure: GatewayFailure) => void;
}

// Settles the slot, fills it when the file landed and reports a refusal.
export function finishUpload(
  slot: ImageSlot,
  result: GatewayResult<ThemeAsset>,
  values: ImageValues,
  to: UploadAnswer,
): void {
  to.show((was) => slotAfterUpload(was, slot, result));
  const image = uploadedImage(slot, result, values);
  if (image !== null) to.edit(slot, image);
  reportFailure(result, to.report);
}

// Sets a logo's alt text where a logo is set.
export function editAlt(
  values: ImageValues,
  slot: 'logo' | 'darkLogo',
  alt: string,
  edit: (slot: ImageSlot, logo: Logo) => void,
): void {
  const logo = altEdited(values, slot, alt);
  if (logo !== null) edit(slot, logo);
}

// Empties the slot that still names a deleted image.
export function forgetImage(
  values: ImageValues,
  slot: ImageSlot,
  assetId: string,
  edit: (slot: ImageSlot, image: null) => void,
): void {
  if (slotNames(values, slot, assetId)) edit(slot, null);
}

// Runs `select` for a tab this area has, and for no other name.
export function selectOffered(name: string, select: (tab: OfferedTab) => void): void {
  const tab = tabNamed(OFFERED_TABS, name);
  if (tab !== undefined) select(tab);
}
