const router = {
  set(path: string) {
    return path;
  },
};

export const where = router.set('x');
export class Limits {
  static readonly MAX = 3;
  readonly items: string[] = [];
}
export const limits = new Limits();

export function go(): void {
  window.location.href = '/next';
  window.onbeforeunload = null;
}
