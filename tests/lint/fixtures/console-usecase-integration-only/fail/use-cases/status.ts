export function useRefusal(result: { status: number }): boolean {
  return result.status === 403;
}
