import { useRefusal } from '#/features/session';
import type { ThemeWrites } from '#/features/branding/repository/useThemeWrites';
import {
  publishFailure,
  publishOutcomeOf,
  announcePublish,
  currentOutcome,
  NO_OUTCOME,
  writeCapability,
  type PublishOutcome,
  type ThemeScope,
} from '#/features/branding/service';
import { useToast } from '#/shared/repository/useToasts';
import { reportFailure } from '#/shared/service/settled';

export interface Publication {
  busy: boolean;
  // Why Publish is held, when it is.
  hold: string | undefined;
  outcome: PublishOutcome;
  publish: () => void;
}

export function usePublication({
  tenant,
  scope,
  tag,
  hold,
  writes,
  outcome,
  onOutcome,
}: {
  tenant: string;
  scope: ThemeScope;
  tag: string;
  // Why Publish is held, from everything that bears on it.
  hold: string | undefined;
  writes: ThemeWrites;
  // The last answer, held by the page so every tab can mark what it refused.
  outcome: PublishOutcome;
  onOutcome: (outcome: PublishOutcome) => void;
}): Publication {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const answered = (next: PublishOutcome): void => {
    onOutcome(next);
    announcePublish(next, toast.succeeded);
  };
  return {
    busy: writes.publish.busy,
    hold,
    outcome: currentOutcome(outcome, tag),
    publish: () => {
      onOutcome(NO_OUTCOME);
      writes.publish
        .run(tag)
        .then((result) => {
          answered(publishOutcomeOf(result, publishFailure, tag));
          reportFailure(result, (failure) => {
            refusal.report(failure, writeCapability(scope));
          });
        })
        .catch(() => {
          answered(publishOutcomeOf({ ok: false, kind: 'defect' }, publishFailure, tag));
        });
    },
  };
}
