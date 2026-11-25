import { refusedBy, writeFailureText } from '#/shared/lib/services/failure';
import { counted } from '#/shared/lib/services/format';
import type { Read } from '#/shared/lib/services/read';
import type { GatewayFailure } from '#/shared/lib/services/result';
import type { AgentInstance, RevokeCount } from '#/pages/agents/types/agent';

export type Impact =
  | { kind: 'reading' }
  | { kind: 'unknown' }
  | { kind: 'counted'; grants: number; instances: number };

// From the dry count alone: a count that could not be read is never none.
export function countOf(read: Read<RevokeCount>): Impact {
  if (read.status === 'loading') return { kind: 'reading' };
  if (read.status === 'failed') return { kind: 'unknown' };
  return { kind: 'counted', grants: read.data.grants, instances: read.data.instances };
}

// A person who cannot see what goes with the run is not asked to confirm it.
export function revokeHeld(impact: Impact): boolean {
  return impact.kind !== 'counted';
}

export interface ImpactRetry {
  label: string;
  run: () => void;
}

export function revokeRetry(read: Read<RevokeCount>): ImpactRetry | null {
  if (read.status !== 'failed') return null;
  return { label: 'Read again', run: read.retry };
}

export function revokeTitle(client: string): string {
  return `Revoke the run of ${client}?`;
}

export function revokeConsequence(client: string, impact: Impact): string {
  switch (impact.kind) {
    case 'reading':
      return `Checking what revoking this run of ${client} ends…`;
    case 'unknown':
      return `What revoking this run of ${client} ends could not be read, so the revoke is held.`;
    case 'counted':
      return `Revoking this run of ${client} ends ${counted(impact.instances, 'instance', 'instances')}, this one and every run started beneath it, and revokes ${counted(impact.grants, 'grant', 'grants')}. The tokens those grants hold stop working at once. This cannot be undone.`;
  }
}

export function revokedText(client: string, ended: RevokeCount): string {
  if (ended.instances === 0 && ended.grants === 0) {
    return `The run of ${client} had already ended, so nothing more was ended.`;
  }
  return `The run of ${client} ended: ${counted(ended.instances, 'instance', 'instances')} and ${counted(ended.grants, 'grant', 'grants')}.`;
}

export function revokeFailure(failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: 'The revoke of this run',
    verb: 'done',
    lookAt: 'the list of agents',
    refused: refusedBy('manage-sessions'),
    missing: 'This run is gone: it may have been removed since the list was read.',
  });
}

export interface RevokeDialog {
  title: string;
  consequence: string;
  held: boolean;
}

// The confirmation of a revoke, drawn only while one is asked.
export function revokeDialogOf(
  asked: Pick<AgentInstance, 'agentClient'> | null,
  impact: Impact,
): RevokeDialog | null {
  if (asked === null) return null;
  return {
    title: revokeTitle(asked.agentClient),
    consequence: revokeConsequence(asked.agentClient, impact),
    held: revokeHeld(impact),
  };
}

// What the dry count is read for: the run being asked about, and whether one is.
export function revokeTargetOf(asked: Pick<AgentInstance, 'id'> | null): {
  id: string;
  asked: boolean;
} {
  return { id: asked?.id ?? '', asked: asked !== null };
}
