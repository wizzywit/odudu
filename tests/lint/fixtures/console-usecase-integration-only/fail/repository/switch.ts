export function useRead(kind: 'a' | 'b'): number {
  switch (kind) {
    case 'a':
      return 1;
    case 'b':
      return 2;
  }
}
