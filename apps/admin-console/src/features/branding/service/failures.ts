import { isMissing, isStale, problemSubtype, writeFailureText } from '#/shared/service/failure';
import type { GatewayFailure, GatewayResult } from '#/shared/service/result';
import { inUse, inUseTitle } from '#/features/branding/service/assets';
import { publishConflict, refusalText } from '#/features/branding/service/publish';

export function publishFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The theme',
    verb: 'published',
    lookAt: 'the published version above',
    stale: publishConflict(),
    refused: (problem) => refusalText(problem, 'published'),
  });
}

export function restoreFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The version',
    verb: 'restored',
    lookAt: 'the published version above',
    missing: 'The version no longer exists.',
    refused: (problem) => refusalText(problem, 'restored'),
  });
}

export function resetFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The theme',
    verb: 'reset',
    lookAt: 'the published version above',
  });
}

// An image a theme still names says which themes, so each can be changed.
export function deleteImageFailure(failure: GatewayFailure): string {
  const found = failure.kind === 'problem' ? inUse(failure.problem) : null;
  if (found !== null) return `${inUseTitle(found)} ${found.lines.join(' ')}`;
  return writeFailureText(failure, {
    name: 'The image',
    verb: 'deleted',
    lookAt: 'the images above',
  });
}

// The refusal says the draft the page shows is not the draft there is: its
// tag no longer matches, or it is gone. The page reads it again.
export function draftMoved(result: GatewayResult<unknown>): boolean {
  if (result.ok) return false;
  return (
    isStale(result) ||
    isMissing(result) ||
    (result.kind === 'problem' && problemSubtype(result.problem) === 'theme-no-draft')
  );
}
