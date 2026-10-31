import type { MenuEntry, MenuItem } from './contextMenu';
import { nextFocusIndex, type NavigationKey } from './menu';

const NAVIGATION_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
const EDGE_PX = 4;

/**
 * A menu at the pointer, in HTML like every other menu of the page. It closes when an item is chosen, on Escape,
 * when the pointer goes down outside it, and when the window changes under it. Arrow keys, Home and End walk
 * the items and Enter chooses; the focus goes back to where it was.
 */
export class ContextMenuView {
  private menu: HTMLElement | null = null;
  private returnTo: Element | null = null;
  private readonly closeOutside = (e: Event) => {
    if (this.menu && !(e.target instanceof Node && this.menu.contains(e.target))) this.close();
  };
  private readonly closeNow = () => this.close();

  isOpen(): boolean {
    return this.menu !== null;
  }

  open(x: number, y: number, entries: readonly MenuEntry[], onChoose: (item: MenuItem) => void): void {
    this.close();
    if (entries.length === 0) return;
    this.returnTo = document.activeElement;
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    for (const entry of entries) {
      if (entry === 'separator') {
        menu.append(document.createElement('hr'));
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'context-item';
      button.setAttribute('role', 'menuitem');
      button.disabled = entry.disabled === true;
      const label = document.createElement('span');
      label.textContent = entry.label;
      button.append(label);
      if (entry.shortcut) {
        const keys = document.createElement('kbd');
        keys.textContent = entry.shortcut;
        keys.setAttribute('translate', 'no');
        button.append(keys);
      }
      button.addEventListener('click', () => {
        this.close();
        onChoose(entry);
      });
      menu.append(button);
    }
    // The keys of the menu are not the keys of the drawing: Escape here must not also let go of the selection.
    menu.addEventListener('keydown', (e) => {
      e.stopPropagation();
      this.onKey(e);
    });
    menu.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.append(menu);
    this.menu = menu;
    // Measured once it is in the page, so it can be kept inside the window.
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(EDGE_PX, Math.min(x, window.innerWidth - width - EDGE_PX))}px`;
    menu.style.top = `${Math.max(EDGE_PX, Math.min(y, window.innerHeight - height - EDGE_PX))}px`;
    window.addEventListener('pointerdown', this.closeOutside, true);
    window.addEventListener('resize', this.closeNow);
    window.addEventListener('blur', this.closeNow);
    this.items()[0]?.focus();
  }

  close(): void {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    window.removeEventListener('pointerdown', this.closeOutside, true);
    window.removeEventListener('resize', this.closeNow);
    window.removeEventListener('blur', this.closeNow);
    if (this.returnTo instanceof HTMLElement && document.contains(this.returnTo)) this.returnTo.focus();
    this.returnTo = null;
  }

  private items(): HTMLButtonElement[] {
    return this.menu ? [...this.menu.querySelectorAll<HTMLButtonElement>('.context-item:not(:disabled)')] : [];
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      this.close();
      return;
    }
    if (!NAVIGATION_KEYS.includes(e.key)) return;
    e.preventDefault();
    const items = this.items();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    items[nextFocusIndex(current, items.length, e.key as NavigationKey)]?.focus();
  }
}
