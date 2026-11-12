/** Always mounted, hidden until something actually breaks. */

const PANEL_ID = 'boot-error';

function panel(): HTMLElement {
  const existing = document.getElementById(PANEL_ID);
  if (existing) return existing;
  const node = document.createElement('div');
  node.id = PANEL_ID;
  node.hidden = true;
  node.setAttribute('role', 'alert');
  const text = document.createElement('pre');
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    node.hidden = true;
  });
  node.append(text, dismiss);
  document.body.append(node);
  return node;
}

export function reportError(source: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('ResizeObserver loop')) return;
  const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : '';
  const node = panel();
  const text = node.querySelector('pre');
  const line = `${source}: ${message}${stack ? `\n${stack}` : ''}`;
  if (text) text.textContent = text.textContent ? `${text.textContent}\n\n${line}` : line;
  node.hidden = false;
}

export function installErrorReporter(): void {
  const view = window as Window & {
    __reportError?: (source: string, err: unknown) => void;
    __bootHook?: boolean;
  };
  view.__reportError = reportError;
  if (view.__bootHook) return;
  view.__bootHook = true;
  window.addEventListener('error', (event) => {
    reportError('error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError('unhandledrejection', event.reason);
  });
}
