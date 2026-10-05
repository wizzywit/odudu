export function useStale(result: { status: number }): boolean {
  return 412 !== result.status;
}
