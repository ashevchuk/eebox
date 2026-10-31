export type NavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/** The item to focus after a navigation key; `current` is -1 when no item has focus. */
export function nextFocusIndex(current: number, count: number, key: NavigationKey): number {
  if (count === 0) return -1;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
  }
}

const ITEM_SELECTOR = '.menu-item:not(:disabled)';
const WINDOW_MARGIN_PX = 6;

/**
 * How far a box at `left` and `width` must move sideways to lie inside a window of `windowWidth` with a margin; the left
 * edge wins when the box is wider than the window.
 */
export function shiftIntoWindow(left: number, width: number, windowWidth: number, margin: number = WINDOW_MARGIN_PX): number {
  const overRight = left + width - (windowWidth - margin);
  const shifted = overRight > 0 ? left - overRight : left;
  return Math.max(shifted, margin) - left;
}

/**
 * Turns every `.menu` (a `.menu-button` followed by a `.menu-list`) into a dropdown. A menu closes
 * when an item is chosen, when the pointer goes down outside, or on Escape. Controls inside a menu
 * that are not items, such as the enclosure select, leave it open.
 */
export function initMenus(root: ParentNode = document): void {
  const menus = [...root.querySelectorAll<HTMLElement>('.menu')];
  const partsOf = (menu: HTMLElement) => ({
    button: menu.querySelector<HTMLButtonElement>('.menu-button')!,
    list: menu.querySelector<HTMLElement>('.menu-list')!,
  });
  const isOpen = (menu: HTMLElement) => !partsOf(menu).list.hidden;
  const setOpen = (menu: HTMLElement, open: boolean) => {
    const { button, list } = partsOf(menu);
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      // A list that starts at its button runs off the edge of a narrow window; it is moved back in.
      list.style.transform = '';
      const box = list.getBoundingClientRect();
      const shift = shiftIntoWindow(box.left, box.width, window.innerWidth);
      if (shift !== 0) list.style.transform = `translateX(${Math.round(shift)}px)`;
    }
  };
  const closeAll = () => menus.forEach((menu) => setOpen(menu, false));
  const itemsOf = (menu: HTMLElement) => [...partsOf(menu).list.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
  const focusItem = (menu: HTMLElement, key: NavigationKey) => {
    const items = itemsOf(menu);
    const index = nextFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, key);
    items[index]?.focus();
  };

  for (const menu of menus) {
    const { button, list } = partsOf(menu);

    button.addEventListener('click', () => {
      const open = !isOpen(menu);
      closeAll();
      setOpen(menu, open);
    });
    button.addEventListener('pointerenter', () => {
      if (menus.some((m) => m !== menu && isOpen(m))) {
        closeAll();
        setOpen(menu, true);
      }
    });
    list.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, label.menu-item')) closeAll();
    });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen(menu)) {
        closeAll();
        button.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        if (e.target instanceof HTMLSelectElement) return;
        e.preventDefault();
        setOpen(menu, true);
        focusItem(menu, e.key);
      } else if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLLabelElement) {
        e.preventDefault();
        e.target.querySelector('input')?.click();
        closeAll();
      }
    });
  }

  document.addEventListener('pointerdown', (e) => {
    if (!(e.target as HTMLElement).closest('.menu')) closeAll();
  });
}
