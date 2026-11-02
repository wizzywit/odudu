var visits = 0;

export function visit(): number {
  visits += 1;
  return visits;
}
