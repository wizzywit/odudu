import type { PublishedLane, SigningKey, SigningKeyStatus } from '#/entities/signing-key';

// What the overview asks of the entities it reads. A service cannot import an
// entity index for values, so the use-case that holds the reads hands these
// in, and each stays owned by its entity.
export interface EntityRules {
  readyToPromote: (keys: readonly SigningKey[], now: Date) => readonly SigningKey[];
  publishedLane: (listed: SigningKeyStatus | undefined, listRead: boolean) => PublishedLane;
}
