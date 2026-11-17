// Whether a verified new address may replace the one a subject holds: no other
// account in the tenant may hold it by now, in any case. The subject's own
// address, in another case, is theirs to take.
export function mayTakeAddress(holder: string | null, subjectId: string): boolean {
  return holder === null || holder === subjectId;
}
