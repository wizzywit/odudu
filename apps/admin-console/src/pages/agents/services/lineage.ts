import type { AgentInstance, LineageNode } from '#/pages/agents/types/agent';

// The loaded runs as trees: each under the run that started it, in the order
// the server listed them. The server lists a parent before its children, so a
// run is detached only where its parent is outside the view, as a state filter
// leaves it; it is then the top of a tree of its own and says so.
export function lineageOf(runs: readonly AgentInstance[]): LineageNode[] {
  const nodes = new Map<string, LineageNode>(
    runs.map((instance) => [instance.id, { instance, children: [], detached: false }]),
  );
  const roots: LineageNode[] = [];
  for (const run of runs) {
    const node = nodes.get(run.id);
    if (node === undefined) continue;
    const parent = run.parent === null ? undefined : nodes.get(run.parent);
    if (parent === undefined) {
      node.detached = run.parent !== null;
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }
  return roots;
}
