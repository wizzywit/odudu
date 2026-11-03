import type { FieldError } from '#/shared/lib/types/fieldError';
import type { PublishThemeResponse } from '#/features/branding-editor/types/theme';
import type { GatewayFailure, GatewayResult } from '#/shared/lib/services/result';
import { PUBLISHED_TOAST } from '#/features/branding-editor/services/publishDraft';
import {
  NO_ISSUES,
  issuesOf,
  warningLines,
  type Issues,
} from '#/features/branding-editor/services/publishIssues';

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
