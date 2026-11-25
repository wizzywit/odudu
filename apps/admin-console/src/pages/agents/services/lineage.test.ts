import { expect, it } from 'vitest';
import { lineageOf } from '#/pages/agents/services/lineage';
import type { AgentInstance } from '#/pages/agents/types/agent';

function run(id: string, parent: string | null, depth = 1): AgentInstance {
  return {
    id,
    owner: 'sub-ada',
    agentClient: 'planner',
    parent,
    depth,
    state: 'live',
    scope: 'mcp:read',
    createdAt: '2026-11-25T08:00:00.000Z',
    expiresAt: '2026-11-25T08:15:00.000Z',
    revokedAt: null,
    budget: { mutating: 20, creates: 10 },
  };
}

it('hangs each run under the run that started it, whatever order the pages gave them', () => {
  const tree = lineageOf([
    run('grandchild', 'child', 3),
    run('root', null),
    run('child', 'root', 2),
  ]);
  expect(tree.map((node) => node.instance.id)).toEqual(['root']);
  expect(tree[0]?.children.map((node) => node.instance.id)).toEqual(['child']);
  expect(tree[0]?.children[0]?.children.map((node) => node.instance.id)).toEqual(['grandchild']);
  expect(tree[0]?.detached).toBe(false);
});

it('keeps the order the server gave among siblings and among roots', () => {
  const tree = lineageOf([run('b', null), run('a', null), run('y', 'b', 2), run('x', 'b', 2)]);
  expect(tree.map((node) => node.instance.id)).toEqual(['b', 'a']);
  expect(tree[0]?.children.map((node) => node.instance.id)).toEqual(['y', 'x']);
});

it('shows a run whose parent is not loaded as a top of its own, and says so', () => {
  const tree = lineageOf([run('orphan', 'elsewhere', 2), run('root', null)]);
  expect(tree.map((node) => [node.instance.id, node.detached])).toEqual([
    ['orphan', true],
    ['root', false],
  ]);
});

it('is empty for no runs', () => {
  expect(lineageOf([])).toEqual([]);
});
