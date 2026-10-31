/** The buttons that go into the More menu when the toolbar does not fit, the one that goes first first. */
export const OVERFLOW_ORDER: readonly string[] = ['ruler', 'duct-tool', 'note-tool', 'find', 'zoom-selection', 'fit', 'delete-selection', 'bundle-mode', 'help', 'check', 'redo', 'toggle-inspector', 'toggle-sidebar', 'undo'];

/** Which of the buttons are put away when `count` have to go, in the order they stand on the page. */
export function hiddenItems(pageOrder: readonly string[], hideOrder: readonly string[], count: number): string[] {
  const gone = new Set(hideOrder.slice(0, count));
  return pageOrder.filter((id) => gone.has(id));
}

const shown = (el: HTMLElement): boolean => el.getBoundingClientRect().width > 0;

/** Leaves a separator only between two things that are shown, so a group that was emptied leaves no gap and no pair of lines. */
function tidySeparators(header: HTMLElement): void {
  let betweenItems = false;
  let last: HTMLElement | null = null;
  for (const child of header.children) {
    const el = child as HTMLElement;
    if (el.matches('.hint, #status')) continue;
    if (el.matches('.toolbar-separator')) {
      el.style.display = betweenItems ? '' : 'none';
      if (betweenItems) last = el;
      betweenItems = false;
    } else if (shown(el)) betweenItems = true;
  }
  if (!betweenItems && last) last.style.display = 'none';
}

/** The toolbar is on more than one row when something stands below the first thing in it, whatever the height of each. */
function wraps(header: HTMLElement): boolean {
  tidySeparators(header);
  const first = header.firstElementChild as HTMLElement | null;
  if (!first) return false;
  const rowBottom = first.getBoundingClientRect().bottom;
  for (const child of header.children) {
    const el = child as HTMLElement;
    if (el === first || el.matches('.hint, #status') || el.offsetParent === null) continue;
    if (el.getBoundingClientRect().top >= rowBottom) return true;
  }
  return false;
}

/**
 * Keeps the toolbar on one row: when it does not fit, the buttons that are used least go into the More menu, one after
 * another, and come back when the window is wide enough. The buttons keep their ids and their handlers; only their
 * place changes. Returns the function that fits the toolbar again, for when the window or the mode changes.
 */
export function initToolbarOverflow(header: HTMLElement): () => void {
  const more = header.querySelector<HTMLElement>('.toolbar-more')!;
  const list = more.querySelector<HTMLElement>('.menu-list')!;
  const entries = OVERFLOW_ORDER.flatMap((id) => {
    const element = header.querySelector<HTMLElement>(`#${id}`);
    return element ? [{ id, element, marker: element.parentNode!.insertBefore(document.createComment(id), element) }] : [];
  });
  const pageOrder = [...entries].sort((a, b) => (a.marker.compareDocumentPosition(b.marker) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((e) => e.id);

  const putBack = () => {
    for (const { element, marker } of entries) {
      if (element.parentNode === list) {
        marker.after(element);
        element.classList.remove('menu-item');
        element.removeAttribute('role');
      }
    }
    more.hidden = true;
  };
  const putAway = (count: number) => {
    putBack();
    const hidden = new Set(hiddenItems(pageOrder, OVERFLOW_ORDER, count));
    for (const { id, element } of entries) {
      if (!hidden.has(id)) continue;
      element.classList.add('menu-item');
      element.setAttribute('role', 'menuitem');
    }
    // In the order of the page, so the menu reads as the toolbar did.
    for (const id of pageOrder) {
      const entry = entries.find((e) => e.id === id)!;
      if (hidden.has(id)) list.append(entry.element);
    }
    more.hidden = hidden.size === 0;
  };

  return () => {
    putBack();
    let count = 0;
    while (wraps(header) && count < OVERFLOW_ORDER.length) {
      const next = entries.find((e) => e.id === OVERFLOW_ORDER[count]);
      count += 1;
      // A button that the mode hides takes no room, so putting it away would change nothing.
      if (!next || getComputedStyle(next.element).display === 'none') continue;
      putAway(count);
    }
  };
}
