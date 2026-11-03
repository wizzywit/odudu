import { writeFailureText } from '#/shared/services/failure';
import { unsavedBlock } from '#/features/branding/services/unsavedBlock';
import type { GatewayFailure } from '#/shared/services/result';
import type { ThemeScope } from '#/features/branding/services/themeScope';

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

export const DISCARDING = 'Discarding…';

export const NO_DRAFT_TO_DISCARD = 'There is no draft to discard.';

export function discardUnsaved(sections: readonly string[]): string {
  return unsavedBlock(sections, 'discarding the draft does not touch them', 'save-or-discard');
}
