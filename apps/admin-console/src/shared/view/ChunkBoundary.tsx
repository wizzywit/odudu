import { Component, type ReactNode } from 'react';
import { ChunkLoadError } from '#/shared/service/chunkLoad.ts';
import { Button } from '#/shared/view/Button.tsx';
import { EmptyState } from '#/shared/view/EmptyState.tsx';

interface ChunkBoundaryProps {
  onReload: () => void;
  children: ReactNode;
}

// Catches a chunk that failed to arrive and nothing else: any other error
// is thrown on to the boundary above, rather than dressed up as this one.
export class ChunkBoundary extends Component<ChunkBoundaryProps, { failed: Error | null }> {
  override state: { failed: Error | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: Error } {
    return { failed: error instanceof Error ? error : new Error(String(error)) };
  }

  override render(): ReactNode {
    const { failed } = this.state;
    if (failed === null) return this.props.children;
    if (!(failed instanceof ChunkLoadError)) throw failed;
    return <ChunkFailed onReload={this.props.onReload} />;
  }
}

export function ChunkFailed({ onReload }: { onReload: () => void }) {
  return (
    <EmptyState
      variant="failed"
      title="This part of the console could not be loaded"
      action={
        <Button variant="primary" onPress={onReload}>
          Reload the console
        </Button>
      }
    >
      The console may have been updated since this page was opened. Reloading fetches the new
      version.
    </EmptyState>
  );
}
