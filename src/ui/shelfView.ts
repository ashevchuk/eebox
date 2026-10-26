import { discardFromShelf } from '../layout/shelf';
import type { ShelfItem } from '../layout/placement';
import type { Session } from './session';

/** Lists the modules taken off their rails; drag one back onto a rail, or discard it for good. */
export class ShelfView {
  private signature = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly session: Session,
    private readonly onDragStart: (e: PointerEvent, item: ShelfItem) => void,
  ) {
    session.subscribe(() => this.refresh());
    this.refresh();
  }

  private refresh(): void {
    const { shelf } = this.session.project.panel;
    const signature = JSON.stringify(shelf.map((s) => [s.id, s.label, s.module]));
    if (signature === this.signature) return;
    this.signature = signature;

    const title = document.createElement('h3');
    title.textContent = `Shelf (${shelf.length})`;
    this.container.replaceChildren(title);
    if (shelf.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = 'Take a module off its rail and it waits here.';
      this.container.append(hint);
      return;
    }
    for (const item of shelf) this.container.append(this.row(item));
  }

  private row(item: ShelfItem): HTMLElement {
    const def = this.session.resolve(item.module);
    const row = document.createElement('div');
    row.className = 'module shelf-item';
    const name = document.createElement('span');
    name.textContent = item.label ?? def?.name ?? `${item.module.moduleId} (missing)`;
    const discard = document.createElement('button');
    discard.textContent = '×';
    discard.title = 'Discard for good';
    discard.addEventListener('click', () => {
      const result = discardFromShelf(this.session.project.panel, item.id);
      if (result.ok) this.session.commit({ ...this.session.project, panel: result.panel });
    });
    discard.addEventListener('pointerdown', (e) => e.stopPropagation());
    row.append(name, discard);
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      row.setPointerCapture(e.pointerId);
      this.onDragStart(e, item);
    });
    return row;
  }
}
