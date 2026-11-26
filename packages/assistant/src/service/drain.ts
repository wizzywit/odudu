import { UPKEEP_MAX_ROUNDS } from '#/service/limits';

/**
 * Runs `take` again while it returns at least `bound` rows, which is how a
 * batch that came back full says there may be more, and stops after
 * `UPKEEP_MAX_ROUNDS` rounds whatever remains. Resolves to the rows taken.
 */
export async function drain(take: () => Promise<number>, bound: number): Promise<number> {
  let total = 0;
  for (let round = 0; round < UPKEEP_MAX_ROUNDS; round += 1) {
    const taken = await take();
    total += taken;
    if (taken < bound) break;
  }
  return total;
}
