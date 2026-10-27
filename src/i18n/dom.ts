import type { Catalogue } from './catalogue';

const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'] as const;
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

const skipped = (node: Node): boolean => {
  const element = node instanceof Element ? node : node.parentElement;
  return !element || SKIPPED_TAGS.has(element.tagName) || element.closest('[translate="no"]') !== null;
};

function translateAttributes(element: Element, catalogue: Catalogue): void {
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    const translated = catalogue.translate(value);
    if (translated !== value) element.setAttribute(name, translated);
  }
}

/** Puts the text and the hints of everything under `root` into the language of the catalogue. */
export function translateTree(root: Node, catalogue: Catalogue): void {
  if (root instanceof Text) {
    if (!skipped(root)) {
      const translated = catalogue.translate(root.data);
      if (translated !== root.data) root.data = translated;
    }
    return;
  }
  if (!(root instanceof Element) || skipped(root)) return;
  translateAttributes(root, catalogue);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      if (!skipped(node)) {
        const translated = catalogue.translate(node.data);
        if (translated !== node.data) node.data = translated;
      }
    } else if (node instanceof Element && !skipped(node)) translateAttributes(node, catalogue);
  }
}

/** Translates the document now and everything that is put into it later. */
export function translateDocument(catalogue: Catalogue): MutationObserver {
  translateTree(document.body, catalogue);
  translateAttributes(document.documentElement, catalogue);
  document.title = catalogue.translate(document.title);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') record.addedNodes.forEach((node) => translateTree(node, catalogue));
      else if (record.type === 'characterData') translateTree(record.target, catalogue);
      else if (record.target instanceof Element && !skipped(record.target)) translateAttributes(record.target, catalogue);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
  return observer;
}
