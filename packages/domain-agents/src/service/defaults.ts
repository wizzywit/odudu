export const STRUCTURAL_MAX_DEPTH = 8;

export const AGENT_DEFAULTS = {
  maxDepth: 3,
  maxChildren: 20,
  maxLiveInstances: 1000,
  instanceTtlSeconds: 900,
  idleTtlSeconds: 1800,
  approvalTtlSeconds: 600,
  approvalTtlCapSeconds: 900,
  writesPerGrant: 20,
  createsPerGrant: 10,
  windowWrites: 1000,
} as const;
