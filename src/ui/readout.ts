export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function card(title?: string): { element: HTMLElement; body: HTMLElement } {
  const element = el('section', 'card');
  const body = el('div');
  if (title) element.append(el('h2', '', title), body);
  else element.append(body);
  return { element, body };
}

export function stat(parent: HTMLElement, label: string): { set: (main: string, sub?: string) => void; main: HTMLElement } {
  const row = el('div', 'kv');
  row.append(el('span', 'dim', label));
  const val = el('div');
  const main = el('div', 'num');
  const sub = el('div', 'faint');
  val.append(main, sub);
  row.append(val);
  parent.append(row);
  let prev = '';
  return {
    main,
    set(text: string, subText?: string) {
      if (main.textContent !== text) {
        main.textContent = text;
        if (prev) {
          main.classList.remove('flash');
          void main.offsetWidth;
          main.classList.add('flash');
        }
        prev = text;
      }
      sub.textContent = subText ?? '';
      sub.hidden = !subText;
    },
  };
}

export function bigNumber(parent: HTMLElement): { set: (text: string) => void; el: HTMLElement } {
  const node = el('div', 'num-xl');
  parent.append(node);
  let prev = '';
  return {
    el: node,
    set(text: string) {
      if (node.textContent !== text) {
        node.textContent = text;
        if (prev) {
          node.classList.remove('flash');
          void node.offsetWidth;
          node.classList.add('flash');
        }
        prev = text;
      }
    },
  };
}
