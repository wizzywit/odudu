interface Box {
  getBoundingClientRect: () => { top: number };
  querySelectorAll: (selector: string) => unknown[];
  addEventListener: (name: string) => void;
}

export function top(box: Box): number {
  box.addEventListener('x');
  box.querySelectorAll('a');
  return box.getBoundingClientRect().top;
}
