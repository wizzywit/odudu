// Counts the function components React renders, through the hook React DOM
// reports every commit to. React DOM looks for the hook once, as it loads, so
// tests/setup.ts imports this before anything that imports react-dom. It
// counts only from the first resetRenderCount() in a file.

interface Fiber {
  tag: number;
  type: unknown;
  flags: number;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
}

interface Root {
  current: Fiber;
}

const FUNCTION_COMPONENT = 0;
const FORWARD_REF = 11;
const SIMPLE_MEMO_COMPONENT = 15;
const PERFORMED_WORK = 1;

const counts = new Map<string, number>();
let commits = 0;
let recording = false;

function nameOf(type: unknown): string {
  if (typeof type === 'function') return type.name === '' ? '(anonymous)' : type.name;
  if (typeof type === 'object' && type !== null && 'render' in type) return nameOf(type.render);
  return '(anonymous)';
}

// A fiber's flags outlive the commit that set them, so only the part of the
// tree React rebuilt is read: a subtree whose first child is the very fiber
// it had before was skipped whole.
function visit(fiber: Fiber | null): void {
  for (let at = fiber; at !== null; at = at.sibling) {
    const component =
      at.tag === FUNCTION_COMPONENT || at.tag === FORWARD_REF || at.tag === SIMPLE_MEMO_COMPONENT;
    if (component && (at.flags & PERFORMED_WORK) !== 0) {
      const name = nameOf(at.type);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (at.child !== at.alternate?.child) visit(at.child);
  }
}

Object.defineProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
  configurable: true,
  value: {
    supportsFiber: true,
    inject: () => 1,
    checkDCE: () => undefined,
    onScheduleFiberRoot: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    onCommitFiberUnmount: () => undefined,
    onCommitFiberRoot: (_id: number, root: Root) => {
      if (!recording) return;
      commits += 1;
      visit(root.current);
    },
  },
});

export interface RenderCount {
  commits: number;
  renders: number;
  byComponent: readonly (readonly [string, number])[];
}

export function resetRenderCount(): void {
  recording = true;
  counts.clear();
  commits = 0;
}

export function renderCount(): RenderCount {
  const byComponent = [...counts].sort((a, b) => b[1] - a[1]);
  return { commits, renders: byComponent.reduce((sum, [, n]) => sum + n, 0), byComponent };
}
