import { Component, type ErrorInfo, type ReactNode } from 'react';
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI error', error, info); }
  override render() { return this.state.failed ? <main className="fatal"><div><span className="eyebrow">Something went wrong</span><h1>FuelLedger needs a quick refresh.</h1><p>Your work is safe. Reload the page to continue.</p><button onClick={() => location.reload()}>Reload application</button></div></main> : this.props.children; }
}
