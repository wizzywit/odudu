import { areaTitled, type Area } from '#/entities/area';
import { LANE_WORDS } from '#/pages/signing-keys/services/laneWording';
import { ALG_OPTIONS, STAGE_RULE } from '#/pages/signing-keys/services/stage';

export const KEYS_WORDS = {
  description:
    'The keys that sign this tenant’s tokens, and the ones published for relying parties to verify them.',
  lastAction: 'Last key action',
  lanes: LANE_WORDS,
  columns: {
    key: 'Key',
    algorithm: 'Algorithm',
    created: 'Created',
    readiness: 'Readiness',
    actions: 'Actions',
  },
  promote: 'Promote',
  retire: 'Retire',
  delete: 'Delete',
  activeNote: 'It cannot be retired while it is active.',
  stage: {
    title: 'Stage a key',
    rule: STAGE_RULE,
    algorithm: 'Algorithm',
    options: ALG_OPTIONS,
    submit: 'Stage key',
    staging: 'Staging…',
    last: 'Last stage',
  },
} as const;

export type KeysWords = typeof KEYS_WORDS;

export function keysArea(): { area: Area; title: string } {
  return areaTitled('keys');
}
