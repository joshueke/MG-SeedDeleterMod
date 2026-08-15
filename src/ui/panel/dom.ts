export function setStyles<T extends HTMLElement>(el: T, styles: Partial<CSSStyleDeclaration>): T {
  Object.assign(el.style, styles);
  return el;
}
