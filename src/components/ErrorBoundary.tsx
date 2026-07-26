import { Component, useState, type ReactNode } from 'react';
import './error.css';

const EMAIL = 'gururozatmacaa@gmail.com';

function format(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n\n${err.stack ?? '(no stack)'}`;
  }
  try {
    return typeof err === 'string' ? err : JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}

function ErrorScreen({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent(
    'cv-generator error',
  )}&body=${encodeURIComponent(`Hi, I hit this error in the app:\n\n${text}`)}`;

  // Never let the crash screen crash: the clipboard is exactly as likely to be
  // refused here as it was in the app that just died.
  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="err-wrap">
      <div className="err-card">
        <div className="err-emoji" aria-hidden="true">
          😵
        </div>
        <h1 className="err-h">Something broke</h1>
        <p className="err-msg">
          Hey, I don't know what this error means. Please screenshot this and email it to{' '}
          <a href={mailto}>{EMAIL}</a> so my Claude can look at it and fix it.
        </p>
        <pre className="err-pre">{text}</pre>
        <div className="err-actions">
          <a className="err-btn primary" href={mailto}>
            Email this error
          </a>
          <button className="err-btn" type="button" onClick={copy}>
            {copied ? 'Copied ✓' : 'Copy error'}
          </button>
          <button className="err-btn" type="button" onClick={() => location.reload()}>
            Reload app
          </button>
        </div>
      </div>
    </div>
  );
}

type State = { error: string | null };

// Catches React render errors (getDerivedStateFromError) AND uncaught runtime /
// unhandled-promise errors (window listeners; these also cover event-handler
// throws, which React boundaries do not catch). Resource 404s are not caught
// (listener is bubble-phase), so a missing favicon won't trip this.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(err: unknown): State {
    return { error: format(err) };
  }

  componentDidMount() {
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }

  onError = (e: ErrorEvent) => {
    if (this.state.error) return;
    // Chrome fires this as a window error event; it's a benign layout notification, not a crash.
    if (/ResizeObserver loop/i.test(e.message)) return;
    // Extension/cross-origin script noise: no Error object and no app source file.
    if (!e.error && !e.filename) return;
    this.setState({ error: format(e.error ?? e.message) });
  };

  onRejection = (e: PromiseRejectionEvent) => {
    if (this.state.error) return;
    this.setState({ error: format(e.reason) });
  };

  render() {
    if (this.state.error !== null) return <ErrorScreen text={this.state.error} />;
    return this.props.children;
  }
}
