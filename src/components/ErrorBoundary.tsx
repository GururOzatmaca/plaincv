import { Component, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent(
    t('err.mailSubject'),
  )}&body=${encodeURIComponent(`${t('err.mailBody')}\n\n${text}`)}`;

  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="err-wrap app-scroll">
      <div className="err-card">
        <div className="err-emoji" aria-hidden="true">
          😵
        </div>
        <h1 className="err-h">{t('err.title')}</h1>
        <p className="err-msg">
          {t('err.msg.before')}
          <a href={mailto}>{EMAIL}</a>
          {t('err.msg.after')}
        </p>
        <pre className="err-pre">{text}</pre>
        <div className="err-actions">
          <a className="err-btn primary" href={mailto}>
            {t('err.email')}
          </a>
          <button className="err-btn" type="button" onClick={copy}>
            {copied ? t('err.copied') : t('err.copy')}
          </button>
          <button className="err-btn" type="button" onClick={() => location.reload()}>
            {t('err.reload')}
          </button>
        </div>
      </div>
    </div>
  );
}

type State = { error: string | null };

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

    if (/ResizeObserver loop/i.test(e.message)) return;

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
