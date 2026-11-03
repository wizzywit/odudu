import {
  activityWords,
  type ActivityWords,
} from '#/features/record-activity/services/activityWords';

// The Activity tab's words where no trail is read, as when the audit is refused.
export function useActivityWords(resource: string): ActivityWords {
  return activityWords(resource);
}
