import type { Equation, SourceItem } from '../content';
import { el } from './readout';

let root: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let katexMod: Promise<typeof import('katex')> | null = null;

function ensure(): void {
  if (root) return;
  root = el('div', 'drawer-back');
  root.hidden = true;
  panel = el('aside', 'drawer');
  root.append(panel);
  root.addEventListener('click', (event) => {
    if (event.target === root) closeDrawer();
  });
  document.body.append(root);
}

export function closeDrawer(): void {
  if (root) root.hidden = true;
}

export function openSources(title: string, items: SourceItem[]): void {
  ensure();
  panel!.replaceChildren();
  const head = el('div', 'field-head');
  head.append(el('h2', '', title));
  const close = el('button', 'btn', 'Close');
  close.type = 'button';
  close.addEventListener('click', closeDrawer);
  head.append(close);
  const list = el('ul');
  for (const item of items) {
    const li = el('li');
    for (const part of item.parts) {
      if (part.href) {
        const a = el('a', '', part.text);
        a.href = part.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.append(a);
      } else li.append(document.createTextNode(part.text));
    }
    list.append(li);
  }
  panel!.append(head, list);
  root!.hidden = false;
}

export async function openEquations(title: string, items: Equation[]): Promise<void> {
  ensure();
  panel!.replaceChildren();
  const head = el('div', 'field-head');
  head.append(el('h2', '', title));
  const close = el('button', 'btn', 'Close');
  close.type = 'button';
  close.addEventListener('click', closeDrawer);
  head.append(close);
  panel!.append(head);
  if (!katexMod) katexMod = import('katex');
  const katex = (await katexMod).default;
  await import('katex/dist/katex.min.css');
  for (const item of items) {
    panel!.append(el('h3', 'section-title', item.title));
    const box = el('div');
    katex.render(item.tex, box, { throwOnError: false, displayMode: true });
    panel!.append(box);
  }
  root!.hidden = false;
}
