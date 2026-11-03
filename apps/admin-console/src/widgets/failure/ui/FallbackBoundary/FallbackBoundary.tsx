import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { FailureReport } from '#/widgets/failure/services/failureReport';
import { MinimalFailure } from '#/widgets/failure/ui/MinimalFailure';

interface FallbackBoundaryProps {
  // Logs the failure the screen was drawn for, which its own effect never got
  // to log, and gives the id it was logged under.
  record: (error: unknown, componentStack?: string) => FailureReport;
  // The error the failure screen was drawn for.
  first: unknown;
  children: ReactNode;
}

// Around the failure screen alone: if drawing it fails too, the first error
// is logged and a minimal page stands in, rather than a blank one.
export class FallbackBoundary extends Component<
  FallbackBoundaryProps,
  { failed: boolean; report: FailureReport | null }
> {
  override state: { failed: boolean; report: FailureReport | null } = {
    failed: false,
    report: null,
  };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  override componentDidCatch(_error: unknown, info: ErrorInfo): void {
    this.setState({
      report: this.props.record(this.props.first, info.componentStack ?? undefined),
    });
  }

  override render(): ReactNode {
    return this.state.failed ? <MinimalFailure report={this.state.report} /> : this.props.children;
  }
}
