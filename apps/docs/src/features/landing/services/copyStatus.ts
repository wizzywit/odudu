export type CopyStatus = 'idle' | 'copied' | 'failed';

export const COPIED_FOR_MS = 2000;

const NOTES: Record<CopyStatus, string> = {
  idle: 'Needs Docker with Compose v2.',
  copied: 'Copied to your clipboard.',
  failed: 'Your browser would not copy it. Select the command and copy it by hand.',
};

export function noteFor(status: CopyStatus): string {
  return NOTES[status];
}

export function copyLabel(status: CopyStatus): 'Copied' | 'Copy' {
  return status === 'copied' ? 'Copied' : 'Copy';
}

// Idle needs no clock; any other status is cleared by one.
export function copyTimerIdle(status: CopyStatus): boolean {
  return status === 'idle';
}

export function copyStatusOf(copied: boolean): CopyStatus {
  return copied ? 'copied' : 'failed';
}
