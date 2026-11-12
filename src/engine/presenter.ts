/** Presenter mode trades a little resolution for frame-time headroom. */

const KEY = 'presenter';
type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

function fallback(): boolean {
  return window.matchMedia('(max-width: 899px)').matches;
}

export function presenterOn(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* private mode or a blocked store */
  }
  return fallback();
}

export function setPresenter(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* the switch still applies for this session */
  }
  for (const listener of listeners) listener(on);
}

export function subscribePresenter(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mountPresenter(): void {
  const tools = document.getElementById('top-tools');
  const button = document.getElementById('settings');
  const pop = document.getElementById('settings-pop');
  const toggle = document.getElementById('presenter-toggle');
  if (!tools || !button || !pop || !(toggle instanceof HTMLInputElement)) return;
  const sync = () => {
    toggle.checked = presenterOn();
    button.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
  };
  sync();
  button.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    button.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
  });
  toggle.addEventListener('change', () => setPresenter(toggle.checked));
  subscribePresenter(sync);
  document.addEventListener('pointerdown', (event) => {
    if (pop.hidden) return;
    const node = event.target;
    if (node instanceof Node && (tools.contains(node) || pop.contains(node))) return;
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
}
