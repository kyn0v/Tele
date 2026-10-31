import { createLocale } from './i18n.js';

export const locale = createLocale(() => localStorage, navigator.languages.length ? navigator.languages : [navigator.language]);
export function liveText(node: Node, initial: () => string = () => '') {
  let value = initial;
  const update = () => { node.textContent = value(); };
  locale.subscribe(update);
  update();
  return (next: () => string) => { value = next; update(); };
}
export function liveAttribute(node: Element, name: string, value: () => string) {
  const update = () => node.setAttribute(name, value());
  locale.subscribe(update);
  update();
}
const selector = document.querySelector<HTMLSelectElement>('#locale');
if (!selector) throw new Error('Missing language selector');
const control = selector;
const update = () => { document.documentElement.lang = locale.current; control.value = locale.current; };
locale.subscribe(update); update();
liveAttribute(control, 'aria-label', () => locale.messages.language);
const label = document.querySelector('#locale-label');
if (label) liveText(label, () => locale.messages.language);
control.addEventListener('change', () => locale.set(control.value));
