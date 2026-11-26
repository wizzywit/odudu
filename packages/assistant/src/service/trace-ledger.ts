import { TURN_BYTES, TURN_EVENTS } from '#/service/trace-payload';

export interface Ledger {
  /** The place the event takes in the turn, or undefined when the turn's bound is reached. */
  admit(bytes: number): number | undefined;
  /** How many events were refused. */
  dropped(): number;
  /** The place kept for the note that events were left out. */
  closingSeq(): number;
}

/**
 * What one turn has kept of its trace: events are numbered from zero up to the
 * turn's bound, and past it, or past its bytes, they are counted and not kept.
 * The last place is held back for the note that says so.
 */
export function createLedger(): Ledger {
  let seq = 0;
  let bytes = 0;
  let dropped = 0;
  return {
    admit(size) {
      if (seq >= TURN_EVENTS - 1 || bytes + size > TURN_BYTES) {
        dropped += 1;
        return undefined;
      }
      bytes += size;
      seq += 1;
      return seq - 1;
    },
    dropped: () => dropped,
    closingSeq: () => TURN_EVENTS - 1,
  };
}
