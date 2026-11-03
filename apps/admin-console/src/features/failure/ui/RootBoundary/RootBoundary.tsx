import { Component, type ReactNode } from 'react';
import type { FailureReport } from '#/features/failure/services/failureReport';
import { FallbackBoundary } from '#/features/failure/ui/FallbackBoundary';
import { RootFailure } from '#/features/failure/ui/RootFailure';

interface RootBoundaryProps {
  // Read when something fails, so it names the route the router was on.
  route: () => string;
  record: (error: unknown, componentStack?: string) => FailureReport;
  children: ReactNode;
}

// The last boundary: whatever no route caught. It holds the error and draws.
export class RootBoundary extends Component<RootBoundaryProps, { failed: [unknown] | null }> {
  override state: { failed: [unknown] | null } = { failed: null };

  static getDerivedStateFromError(error: unknown): { failed: [unknown] } {
    return { failed: [error] };
  }

  override render(): ReactNode {
    const { failed } = this.state;
    if (failed === null) return this.props.children;
    return (
      <FallbackBoundary first={failed[0]} record={this.props.record}>
        <RootFailure error={failed[0]} route={this.props.route()} />
      </FallbackBoundary>
    );
  }
}
