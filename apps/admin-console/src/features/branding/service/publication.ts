import type { ThemeBodyRequest, ThemeBodyWire } from '@odudu/contracts';
import type { ThemeView } from '@odudu/contracts/admin';
import { writeFailureText } from '#/shared/service/failure';
import { andList } from '#/shared/service/format';
import type { AdminCapability } from '#/shared/service/principal';
import type { GatewayFailure, GatewayResult } from '#/shared/service/result';
import {
  COLOURS_TITLE,
  IMAGES_TITLE,
  STYLESHEET_SECTION_TITLE,
  TEMPLATES_SECTION_TITLE,
  unsavedSections,
} from '#/features/branding/service/fields';
import type { ThemeScope } from '#/features/branding/service/scope';
import {
  BRANDING_TAB_SECTIONS,
  OFFERED_TABS,
  type BrandingTab,
  type OfferedTab,
  type ScopedTab,
} from '#/features/branding/service/tabs';
import { EMPTY_BODY, baseBody } from '#/features/branding/service/values';

export type ChangedPiece = ThemeView['changed'][number];

// The pieces the server compares, in the order their sections sit on the tabs.
const PIECE_TITLES: Readonly<Record<ChangedPiece, string>> = {
  tokens: COLOURS_TITLE,
  assets: IMAGES_TITLE,
  stylesheet: STYLESHEET_SECTION_TITLE,
  templates: TEMPLATES_SECTION_TITLE,
};

const PIECE_ORDER = Object.keys(PIECE_TITLES) as readonly ChangedPiece[];

// What each tab edits, which is what its revert takes back.
const TAB_PIECES: Readonly<Record<BrandingTab, readonly ChangedPiece[]>> = {
  theme: ['tokens', 'assets', 'stylesheet'],
  pages: ['templates'],
  mail: [],
  languages: [],
};

export function changedText(view: ThemeView): string | null {
  const titles = PIECE_ORDER.filter((piece) => view.changed.includes(piece)).map(
    (piece) => PIECE_TITLES[piece],
  );
  return titles.length === 0 ? null : `Changed: ${titles.join(', ')}`;
}

// The line under the bar's status: what is waiting, or that nothing is.
export function barText(view: ThemeView): string {
  if (view.draft === null) return 'No draft.';
  return changedText(view) ?? 'The draft matches what people see.';
}

// The tabs holding part of what would change at a publish.
export function tabsChanged(changed: ThemeView['changed']): ReadonlySet<OfferedTab> {
  return new Set(
    OFFERED_TABS.filter((tab) => TAB_PIECES[tab].some((piece) => changed.includes(piece))),
  );
}

export const REVERT_TITLE = 'Revert to published';

export const REVERT_LABEL = 'Revert this tab to published';

export const REVERTING = 'Reverting…';

export const REVERT_DONE = 'Tab reverted to published';

export function revertLead(scope: ThemeScope): string {
  const under = scope.kind === 'tenant' ? 'is cleared' : 'falls back to the tenant’s theme';
  return `Writes the draft again with this tab’s parts as published; a part with nothing published ${under}. The other tabs keep their changes, and nothing is published.`;
}

export const TAB_MATCHES = 'This tab already matches what is published.';

export function revertUnsaved(sections: readonly string[]): string {
  return `Save your changes first, in ${andList(sections.map((title) => `“${title}”`))}: reverting works on the saved draft.`;
}

// The sections of one tab holding unsaved edits.
export function tabUnsaved(tab: BrandingTab, dirty: ReadonlySet<string>): readonly string[] {
  return unsavedSections(
    new Set([...dirty].filter((id) => BRANDING_TAB_SECTIONS[tab].includes(id))),
  );
}

export function revertHold({
  view,
  tab,
  unsaved,
}: {
  view: ThemeView;
  tab: ScopedTab;
  unsaved: readonly string[];
}): string | undefined {
  if (unsaved.length > 0) return revertUnsaved(unsaved);
  const holds = TAB_PIECES[tab].some((piece) => view.changed.includes(piece));
  return holds ? undefined : TAB_MATCHES;
}

const PIECE_OF: Readonly<Record<ChangedPiece, (body: ThemeBodyWire) => Partial<ThemeBodyWire>>> = {
  tokens: (body) => ({ tokens: body.tokens }),
  assets: (body) => ({ assets: body.assets }),
  stylesheet: (body) => ({ stylesheet: body.stylesheet }),
  templates: (body) => ({ templates: body.templates }),
};

// The draft written again with a tab's pieces as the scope's own published
// theme has them, or empty where it has none; every other piece stays.
export function revertRequest(view: ThemeView, tab: ScopedTab): ThemeBodyRequest {
  const published = view.published?.body ?? EMPTY_BODY;
  const taken = TAB_PIECES[tab].map((piece) => PIECE_OF[piece](published));
  return Object.assign({}, baseBody(view), ...taken) as ThemeBodyRequest;
}

export function revertFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The tab',
    verb: 'reverted',
    lookAt: 'the draft above',
    stale:
      'Somebody saved the draft after you opened it. The page now shows their version: look it over, then revert if you still want to.',
  });
}

// What a revert's answer says under the button: nothing when it went through.
export function revertProblem(result: GatewayResult<unknown>): string | null {
  return result.ok ? null : revertFailure(result);
}

export function announceRevert(
  result: GatewayResult<unknown>,
  toast: (text: string) => void,
): void {
  if (result.ok) toast(REVERT_DONE);
}

export const DISCARD_LABEL = 'Discard draft…';

export const DISCARD_TITLE = 'Discard the draft?';

export const DISCARD_CONFIRM = 'Discard draft';

export const DISCARD_DONE = 'Draft discarded';

export const DISCARD_BODY_TENANT =
  'Deletes the saved draft and nothing else: what is published stays, and people keep seeing it. Unlike Reset to default, nothing is unpublished.';

export const DISCARD_BODY_CLIENT =
  'Deletes the client’s saved draft and nothing else: what is published for the client stays, and people keep seeing it. Unlike Reset to default, nothing is unpublished.';

export function discardBody(scope: ThemeScope): string {
  return scope.kind === 'tenant' ? DISCARD_BODY_TENANT : DISCARD_BODY_CLIENT;
}

export function discardFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The draft',
    verb: 'discarded',
    lookAt: 'the status above',
    stale:
      'Somebody saved the draft after you opened it. The page now shows their version: look it over, then discard it if you still want to.',
  });
}

// What a scope's writes need: a client's theme is its own client's to change.
export function writeCapability(scope: ThemeScope): AdminCapability {
  return scope.kind === 'tenant' ? 'manage-tenant' : 'manage-clients';
}
