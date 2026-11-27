import { COULD_NOT_FINISH } from '#/shared/lib/services/failure';
import type { GatewayFailure } from '#/shared/lib/services/result';

export const CASE_MEDIA_TYPE = 'application/json';

// The name the server gives the download, so a copy saved here and one saved
// from the API read alike.
export function caseFileName(id: string): string {
  return `assistant-${id}.promptfoo.json`;
}

export function caseSavedText(fileName: string): string {
  return `Saved ${fileName}.`;
}

export function exportFailureText(failure: GatewayFailure): string {
  switch (failure.kind) {
    case 'network':
      return 'The test case could not be fetched. Nothing was saved; try again.';
    case 'schema':
    case 'defect':
      return COULD_NOT_FINISH;
    case 'problem':
      return failure.problem.status === 404
        ? 'This conversation is no longer there.'
        : `The test case could not be exported: ${failure.problem.detail ?? failure.problem.title}`;
  }
}
