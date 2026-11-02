export function useDescribe(kind: 'a' | 'b'): string {
  switch (kind) {
    case 'a':
      return 'first';
    case 'b':
      return 'second';
  }
}
