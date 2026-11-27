import { Component, ErrorInfo, ReactNode } from "react";

export interface ErrorBoundaryFallbackProps {
  error: unknown;
  /** Clear the error and render the children again */
  reset: () => void;
}

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** Shown instead of the children after a render error */
  fallback: (props: ErrorBoundaryFallbackProps) => ReactNode;
  /** Called once per caught error; defaults to `console.error` */
  onError?: (error: unknown, info: ErrorInfo) => void;
  /** Short name used in the default log message */
  name?: string;
}

interface ErrorBoundaryState {
  error: unknown;
  hasError: boolean;
}

/**
 * Generic error boundary: a render error in `children` shows `fallback`
 * instead of unmounting the whole app. `reset` renders the children again.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (this.props.onError) {
      this.props.onError(error, info);
    } else {
      console.error(`[${this.props.name ?? "ErrorBoundary"}]`, error, info.componentStack);
    }
  }

  reset = () => {
    this.setState({ error: null, hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}
