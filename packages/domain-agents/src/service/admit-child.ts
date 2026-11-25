export interface AgentNode {
  readonly scope: readonly string[];
  readonly expiresAt: Date;
  readonly depth: number;
  readonly liveChildren: number;
}

export interface ChildRequest {
  readonly scope: readonly string[];
  readonly expiresAt: Date;
}

export interface AgentLimits {
  readonly maxDepth: number;
  readonly maxChildren: number;
  readonly sessionEndsAt: Date;
}

export type Invariant =
  | 'scope_widened'
  | 'ttl_exceeds_parent'
  | 'ttl_exceeds_session'
  | 'depth_exceeded'
  | 'fanout_exceeded';

export type Admission =
  | { readonly kind: 'ok'; readonly node: AgentNode }
  | { readonly kind: 'refused'; readonly invariant: Invariant };

function refuse(invariant: Invariant): Admission {
  return { kind: 'refused', invariant };
}

/** A grant is passed as a depth-0 parent. Refusals are reported in a fixed order. */
export function admitChild(
  parent: AgentNode,
  request: ChildRequest,
  limits: AgentLimits,
): Admission {
  if (!request.scope.every((s) => parent.scope.includes(s))) return refuse('scope_widened');
  const expiry = request.expiresAt.getTime();
  if (expiry > parent.expiresAt.getTime()) return refuse('ttl_exceeds_parent');
  if (expiry > limits.sessionEndsAt.getTime()) return refuse('ttl_exceeds_session');
  if (parent.depth + 1 > limits.maxDepth) return refuse('depth_exceeded');
  if (parent.liveChildren >= limits.maxChildren) return refuse('fanout_exceeded');
  return {
    kind: 'ok',
    node: {
      scope: request.scope,
      expiresAt: request.expiresAt,
      depth: parent.depth + 1,
      liveChildren: 0,
    },
  };
}
